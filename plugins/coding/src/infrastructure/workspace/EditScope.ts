import type { StagedChange } from "./WorkingCopy";
import { DeclarationCheck } from "./DeclarationCheck";

export type EditRule = Readonly<{
  /** Exact paths an assignment may change. */
  paths: readonly string[];
  /** Language rule applied when the assignment finishes. */
  content:
    | Readonly<{ kind: "any" }>
    | Readonly<{ kind: "declarations" }>
    | Readonly<{ kind: "symbols"; symbols: readonly string[] }>;
  /** Package names the human approved; manifest edits may add only these. */
  authorizedPackages: readonly string[];
}>;

const MANIFEST = /(^|\/)package\.json$/;

/** Validates what an assignment actually changed, whatever commands it used to change it. */
export class EditScope {
  private readonly declarations = new DeclarationCheck();

  constructor(private readonly rule: EditRule) {}

  describe(): string {
    const { content, paths } = this.rule;
    const limit =
      content.kind === "declarations"
        ? ' Add declarations only: new function and method bodies must be `throw new Error("Not implemented")`.'
        : content.kind === "symbols"
          ? ` Change only the bodies of: ${content.symbols.join(", ")}.`
          : "";
    return `You may change only: ${paths.join(", ")}.${limit}`;
  }

  /** Paths outside the assignment; the tool restores them right after the command. */
  outside(changes: readonly StagedChange[]): readonly string[] {
    return changes.map((change) => change.path).filter((file) => !this.rule.paths.includes(file));
  }

  /** Every reason the staged result cannot be accepted, including unapproved dependencies. */
  issues(changes: readonly StagedChange[]): readonly string[] {
    const issues: string[] = [];
    for (const change of changes) {
      if (MANIFEST.test(change.path)) issues.push(...this.manifestIssues(change));
      if (change.after === null || !this.declarations.supports(change.path)) continue;
      const { content } = this.rule;
      const found =
        content.kind === "declarations"
          ? this.declarations.skeletonIssues(change.path, change.before, change.after)
          : content.kind === "symbols" && change.before !== null
            ? this.declarations.scopeIssues(
                change.path,
                change.before,
                change.after,
                content.symbols,
              )
            : [];
      issues.push(...found.map((issue) => `${issue.file}: ${issue.message}`));
    }
    return issues;
  }

  private manifestIssues(change: StagedChange): readonly string[] {
    const names = (text: string | null): ReadonlySet<string> => {
      if (text === null) return new Set();
      const manifest = JSON.parse(text) as Record<string, Record<string, unknown> | undefined>;
      return new Set(
        ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
          (field) => Object.keys(manifest[field] ?? {}),
        ),
      );
    };
    try {
      const before = names(change.before);
      return [...names(change.after)]
        .filter((name) => !before.has(name) && !this.rule.authorizedPackages.includes(name))
        .map(
          (name) =>
            `${change.path}: adding ${name} needs the user's approval; ask with needs-decision.`,
        );
    } catch {
      return [`${change.path}: not valid JSON.`];
    }
  }
}
