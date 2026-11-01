import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PinnedRun } from "../../CodingAgentOptions";

const RUN_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

/**
 * One run's durable files, outside the project: the pinned settings, its state and workflow
 * stores, and its working copy. The agent process has no database access, so this directory
 * is what lets a run wait for a human across processes and server restarts.
 */
export class RunDirectory {
  private constructor(readonly root: string) {}

  static async create(parent: string, runId: string, pinned: PinnedRun): Promise<RunDirectory> {
    const run = RunDirectory.at(parent, runId);
    await mkdir(run.root, { recursive: true, mode: 0o700 });
    await run.write("pinned.json", JSON.stringify(pinned));
    return run;
  }

  static async open(parent: string, runId: string): Promise<RunDirectory> {
    const run = RunDirectory.at(parent, runId);
    await stat(run.pinnedPath);
    return run;
  }

  /** Removes the oldest kept runs, which only stopped or failed runs leave behind. */
  static async prune(parent: string, keep: number): Promise<void> {
    const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
    const runs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => ({
          directory: path.join(parent, entry.name),
          time: (await stat(path.join(parent, entry.name))).mtimeMs,
        })),
    );
    const old = runs.sort((a, b) => b.time - a.time).slice(keep);
    await Promise.all(old.map((run) => rm(run.directory, { recursive: true, force: true })));
  }

  private static at(parent: string, runId: string): RunDirectory {
    if (!RUN_ID.test(runId)) throw new Error("Invalid run ID.");
    return new RunDirectory(path.join(parent, runId));
  }

  get pinnedPath(): string {
    return path.join(this.root, "pinned.json");
  }
  get statePath(): string {
    return path.join(this.root, "state.json");
  }
  get databasePath(): string {
    return path.join(this.root, "run.sqlite");
  }
  get workspacePath(): string {
    return path.join(this.root, "workspace");
  }

  async pinned(): Promise<PinnedRun> {
    return JSON.parse(await readFile(this.pinnedPath, "utf8")) as PinnedRun;
  }

  async remove(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  private async write(name: string, content: string): Promise<void> {
    const file = path.join(this.root, name);
    await writeFile(`${file}.tmp`, content, { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
}
