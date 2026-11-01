import { constants } from "node:fs";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { CliMount } from "kushibot";

const MAX_REVIEW_BYTES = 64 * 1024;
const MAX_FILES = 10_000;
const NEVER_COPIED = new Set([".git", "node_modules"]);

type Manifest = Readonly<{
  /** Path → fingerprint of the project as the run started. */
  files: Readonly<Record<string, string>>;
  /** Paths small and textual enough for change review. */
  reviewable: readonly string[];
  dependencies: readonly string[];
}>;

/** A file's change between the run's working copy and an assignment's stage. */
export type StagedChange = Readonly<{
  path: string;
  before: string | null;
  after: string | null;
}>;

/**
 * The run's own copy of the project; the original is never edited.
 *
 * `copy/` holds accepted work. Assignments edit `stage/`, whose difference from `copy/` is
 * validated before it is merged, because a command's name says nothing about what its
 * subprocesses write. `base/` keeps the original of each file the run changes, so the final
 * diff survives a restart. `.git` is left out and dependencies are mounted read-only.
 */
export class WorkingCopy {
  private readonly excluded: ReadonlySet<string>;

  private constructor(
    private readonly root: string,
    private readonly source: string,
    private readonly manifest: Manifest,
    excluded: readonly string[],
  ) {
    this.excluded = new Set(excluded);
  }

  static async create(
    root: string,
    source: string,
    excluded: readonly string[],
  ): Promise<WorkingCopy> {
    const skipped = new Set(excluded);
    const files = new Map<string, string>();
    const dependencies: string[] = [];
    const walk = async (relative: string): Promise<void> => {
      const directory = path.join(source, relative);
      const target = path.join(root, "copy", relative);
      await mkdir(target, { recursive: true });
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const file = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.name === "node_modules" && entry.isDirectory()) {
          dependencies.push(file);
          await mkdir(path.join(root, "copy", file), { recursive: true });
        }
        if (NEVER_COPIED.has(entry.name) || (entry.isDirectory() && skipped.has(entry.name)))
          continue;
        if (entry.isDirectory()) {
          await walk(file);
          continue;
        }
        if (entry.isSymbolicLink())
          await symlink(await readlink(path.join(source, file)), path.join(root, "copy", file));
        else if (entry.isFile())
          await copyFile(path.join(source, file), path.join(root, "copy", file));
        else continue;
        files.set(file, await WorkingCopy.fingerprint(path.join(root, "copy", file)));
        if (files.size > MAX_FILES) throw new Error(`The project exceeds ${MAX_FILES} files.`);
      }
    };
    await walk("");
    const reviewable: string[] = [];
    for (const file of files.keys())
      if (
        (await WorkingCopy.readText(path.join(root, "copy", file)).catch(() => undefined)) !==
        undefined
      )
        reviewable.push(file);
    const manifest: Manifest = { files: Object.fromEntries(files), reviewable, dependencies };
    await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
    const copy = new WorkingCopy(root, source, manifest, excluded);
    await copy.syncStage();
    return copy;
  }

  static async open(
    root: string,
    source: string,
    excluded: readonly string[],
  ): Promise<WorkingCopy> {
    const manifest = JSON.parse(
      await readFile(path.join(root, "manifest.json"), "utf8"),
    ) as Manifest;
    return new WorkingCopy(root, source, manifest, excluded);
  }

  get copyDirectory(): string {
    return path.join(this.root, "copy");
  }
  get stageDirectory(): string {
    return path.join(this.root, "stage");
  }

  /** Every file in accepted work. */
  async paths(): Promise<readonly string[]> {
    return [...(await this.fingerprints(this.copyDirectory)).keys()];
  }

  /** Identifies the accepted content, for evidence and exact approvals. */
  async revision(): Promise<string> {
    const entries = [...(await this.fingerprints(this.copyDirectory))].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `revision:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`;
  }

  async fingerprintOf(file: string): Promise<string> {
    return WorkingCopy.fingerprint(this.location(this.copyDirectory, file));
  }

  async exists(file: string): Promise<boolean> {
    return lstat(this.location(this.copyDirectory, file)).then(
      (entry) => entry.isFile(),
      () => false,
    );
  }

  /** Accepted content of a reviewable text file, or null when it does not exist. */
  async read(file: string): Promise<string | null> {
    return WorkingCopy.readText(this.location(this.copyDirectory, file));
  }

  /** The file as the run started; null when the run added it. */
  async readOriginal(file: string): Promise<string | null> {
    if (this.manifest.files[file] === undefined) return null;
    const saved = await WorkingCopy.readText(this.location(path.join(this.root, "base"), file));
    return saved ?? WorkingCopy.readText(this.location(this.copyDirectory, file));
  }

  /** Files whose original and current content can both be reviewed. */
  async reviewablePaths(): Promise<readonly string[]> {
    const reviewable = new Set(this.manifest.reviewable);
    for (const file of await this.paths())
      if (this.manifest.files[file] === undefined) reviewable.add(file);
    return [...reviewable].sort();
  }

  /** Makes the stage equal accepted work, copying only what differs. */
  async syncStage(): Promise<void> {
    await mkdir(this.stageDirectory, { recursive: true });
    const stage = await this.fingerprints(this.stageDirectory);
    const copy = await this.fingerprints(this.copyDirectory);
    for (const file of new Set([...stage.keys(), ...copy.keys()]))
      if (stage.get(file) !== copy.get(file)) await this.restore(file);
    for (const dependency of this.manifest.dependencies)
      await mkdir(path.join(this.stageDirectory, dependency), { recursive: true });
  }

  /** Restores one stage file from accepted work. */
  async restore(file: string): Promise<void> {
    const target = this.location(this.stageDirectory, file);
    const source = this.location(this.copyDirectory, file);
    await rm(target, { force: true });
    if (
      await lstat(source).then(
        () => true,
        () => false,
      )
    ) {
      await mkdir(path.dirname(target), { recursive: true });
      await this.place(source, target);
    }
  }

  /** What the stage changed, or the paths that cannot be reviewed. */
  async stagedChanges(): Promise<
    Readonly<{ changes: readonly StagedChange[]; invalid: readonly string[] }>
  > {
    const stage = await this.fingerprints(this.stageDirectory);
    const copy = await this.fingerprints(this.copyDirectory);
    const changes: StagedChange[] = [];
    const invalid: string[] = [];
    for (const file of new Set([...stage.keys(), ...copy.keys()])) {
      if (stage.get(file) === copy.get(file)) continue;
      try {
        changes.push({
          path: file,
          before: copy.has(file)
            ? await WorkingCopy.readText(this.location(this.copyDirectory, file))
            : null,
          after: stage.has(file)
            ? await WorkingCopy.readText(this.location(this.stageDirectory, file))
            : null,
        });
      } catch {
        invalid.push(file);
      }
    }
    return { changes, invalid };
  }

  /** Accepts validated stage content, keeping each file's original for the final diff. */
  async merge(changes: readonly StagedChange[]): Promise<void> {
    for (const change of changes) {
      const accepted = this.location(this.copyDirectory, change.path);
      const original = this.location(path.join(this.root, "base"), change.path);
      if (
        this.manifest.files[change.path] !== undefined &&
        !(await lstat(original).then(
          () => true,
          () => false,
        )) &&
        (await lstat(accepted).then(
          () => true,
          () => false,
        ))
      ) {
        await mkdir(path.dirname(original), { recursive: true });
        await copyFile(accepted, original);
      }
      await rm(accepted, { force: true });
      if (change.after !== null) {
        await mkdir(path.dirname(accepted), { recursive: true });
        await copyFile(this.location(this.stageDirectory, change.path), accepted);
      }
    }
  }

  /** Mounts for reading accepted work, or the stage when `stage` is set. */
  directoryMounts(stage: boolean, writable: boolean): readonly CliMount[] {
    return [
      {
        source: stage ? this.stageDirectory : this.copyDirectory,
        target: "/workspace",
        writable,
      },
      ...this.dependencyMounts(),
    ];
  }

  /** Read-only mounts exposing exactly these files of accepted work. */
  fileMounts(files: readonly string[]): readonly CliMount[] {
    return files.map((file) => ({
      source: this.location(this.copyDirectory, file),
      target: `/workspace/${file}`,
      writable: false,
    }));
  }

  /** A tree of empty placeholders: names can be listed and searched, contents cannot be read. */
  async nameMounts(): Promise<readonly CliMount[]> {
    const directory = path.join(this.root, "names");
    await rm(directory, { recursive: true, force: true });
    for (const file of await this.paths()) {
      const target = this.location(directory, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "");
    }
    await mkdir(directory, { recursive: true });
    return [{ source: directory, target: "/workspace", writable: false }];
  }

  private dependencyMounts(): readonly CliMount[] {
    return this.manifest.dependencies.map((dependency) => ({
      source: path.join(this.source, dependency),
      target: `/workspace/${dependency}`,
      writable: false,
    }));
  }

  private async place(source: string, target: string): Promise<void> {
    const entry = await lstat(source);
    if (entry.isSymbolicLink()) await symlink(await readlink(source), target);
    else await copyFile(source, target);
  }

  private async fingerprints(directory: string): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const walk = async (relative: string): Promise<void> => {
      const entries = await readdir(path.join(directory, relative), { withFileTypes: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      for (const entry of entries) {
        if (NEVER_COPIED.has(entry.name)) continue;
        if (entry.isDirectory() && this.excluded.has(entry.name)) continue;
        const file = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(file);
        else {
          found.set(file, await WorkingCopy.fingerprint(path.join(directory, file)));
          if (found.size > MAX_FILES) throw new Error(`The project exceeds ${MAX_FILES} files.`);
        }
      }
    };
    await walk("");
    return found;
  }

  /** Rejects anything that could leave the directory; `..` and absolute paths never reach it. */
  private location(directory: string, file: string): string {
    if (
      file.length > 512 ||
      path.isAbsolute(file) ||
      file.split("/").some((part) => !part || part === "." || part === ".." || part === ".git")
    )
      throw new Error(`Path is outside the workspace: ${file}`);
    return path.join(directory, file);
  }

  private static async fingerprint(file: string): Promise<string> {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) return `symlink:${await readlink(file)}`;
    if (!stat.isFile() || stat.nlink !== 1)
      return `unsupported:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    return createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  }

  /** @throws For links, binary or oversized files, which change review cannot represent. */
  private static async readText(file: string): Promise<string | null> {
    try {
      const entry = await lstat(file);
      if (!entry.isFile() || entry.nlink !== 1 || entry.size > MAX_REVIEW_BYTES)
        throw new Error(`Cannot review non-regular, hard-linked or oversized file: ${file}`);
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const bytes = await handle.readFile();
        if (bytes.includes(0) || !Buffer.from(bytes.toString("utf8")).equals(bytes))
          throw new Error(`Cannot review binary file: ${file}`);
        return bytes.toString("utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
