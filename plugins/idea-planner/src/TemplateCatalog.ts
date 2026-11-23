import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ToolUseError } from "./ResearchTools";

export type TemplateSummary = Readonly<{
  key: string;
  name: string;
  description: string;
  category: string | null;
  /** Infrastructure the template needs, such as postgres or redis. */
  requires: readonly string[];
}>;

const TEMPLATE_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", "coverage"]);
const TEXT_FILE = /\.(md|ya?ml|json|ts|tsx|js|prisma|sql|txt|env\.example)$|Dockerfile$/i;
const MAX_FILE_BYTES = 24_000;

/** Read-only view of `scaffolding/templates`. Every path stays inside the templates directory. */
export class TemplateCatalog {
  constructor(private readonly root: string) {}

  /** Uses IDEA_PLANNER_TEMPLATES_DIR, else walks up from the workspace to the first scaffolding/templates. */
  static locate(workspace: string, configured = process.env.IDEA_PLANNER_TEMPLATES_DIR): TemplateCatalog {
    if (configured) {
      if (!existsSync(configured)) throw new Error(`IDEA_PLANNER_TEMPLATES_DIR does not exist: ${configured}`);
      return new TemplateCatalog(path.resolve(configured));
    }
    for (let dir = path.resolve(workspace), depth = 0; depth < 8; depth++) {
      for (const candidate of [path.join(dir, "scaffolding", "templates"), path.join(dir, "cognition", "scaffolding", "templates")])
        if (existsSync(candidate) && statSync(candidate).isDirectory()) return new TemplateCatalog(candidate);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(
      `No scaffolding/templates directory was found above ${workspace}. Open the cognition project or set IDEA_PLANNER_TEMPLATES_DIR.`,
    );
  }

  list(): TemplateSummary[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && TEMPLATE_KEY.test(entry.name))
      .map((entry) => this.summary(entry.name))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** The descriptor and README, plus the template's other text files to read next. */
  overview(key: string) {
    const dir = this.templateDir(key);
    return {
      key,
      descriptor: this.readText(path.join(dir, "atlas.template.yml")),
      readme: this.readText(path.join(dir, "README.md")),
      files: this.textFiles(dir).slice(0, 200),
    };
  }

  /** One text file of a template, by its path relative to the template. */
  file(key: string, relativePath: string) {
    const dir = this.templateDir(key);
    const target = path.resolve(dir, relativePath);
    if (!target.startsWith(dir + path.sep)) throw new ToolInputError("The file must be inside the template.");
    if (target.split(path.sep).some((part) => SKIPPED_DIRECTORIES.has(part)))
      throw new ToolInputError("Build output and dependencies cannot be read.");
    if (!TEXT_FILE.test(target)) throw new ToolInputError("Only text source and documentation files can be read.");
    const content = this.readText(target);
    if (content === null) throw new ToolInputError(`No such file: ${relativePath}`);
    return { key, path: relativePath, content };
  }

  private summary(key: string): TemplateSummary {
    const descriptor = this.readText(path.join(this.root, key, "atlas.template.yml")) ?? "";
    const readme = this.readText(path.join(this.root, key, "README.md")) ?? "";
    const top = (field: string) => descriptor.match(new RegExp(`^${field}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
    const head = descriptor.split(/^flow:/m)[0] ?? "";
    return {
      key,
      name: top("name") ?? key,
      description: (top("description") ?? firstParagraph(readme)).slice(0, 400),
      category: descriptor.match(/^\s+category:\s*(.+)$/m)?.[1]?.trim() ?? null,
      requires: [...head.matchAll(/^\s+-\s*type:\s*([\w-]+)/gm)].map((match) => match[1] ?? ""),
    };
  }

  private templateDir(key: unknown): string {
    if (typeof key !== "string" || !TEMPLATE_KEY.test(key)) throw new ToolInputError("A valid template key is required.");
    const dir = path.join(this.root, key);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new ToolInputError(`Unknown template: ${key}. Call list_templates.`);
    return dir;
  }

  private textFiles(dir: string, prefix = ""): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) files.push(...this.textFiles(dir, relative));
      else if (entry.isFile() && TEXT_FILE.test(entry.name)) files.push(relative);
    }
    return files;
  }

  private readText(file: string): string | null {
    if (!existsSync(file) || !statSync(file).isFile()) return null;
    const text = readFileSync(file, "utf8");
    return text.length > MAX_FILE_BYTES ? `${text.slice(0, MAX_FILE_BYTES)}\n…[truncated]` : text;
  }
}

/** A bad tool argument: reported back to the model so it can correct itself. */
export class ToolInputError extends ToolUseError {}

function firstParagraph(markdown: string): string {
  return markdown
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^#+\s.*$/gm, "").trim())
    .find(Boolean) ?? "";
}
