import Joi from "joi";
import {
  JoiArgumentsContract,
  JsonValueContract,
  type CliMount,
  type ICliExecutor,
  type IExecutionContext,
  type ITool,
  type JsonValue,
} from "kushibot";
import type { WorkingCopy } from "../infrastructure/workspace/WorkingCopy";
import type { EditScope } from "../infrastructure/workspace/EditScope";
import type { RunArtifacts } from "../context/RunArtifacts";

/** The host sets this per assignment; nothing the model sends can change it. */
export type CliAccess =
  | Readonly<{ kind: "names" }>
  | Readonly<{ kind: "files"; paths: readonly string[] }>
  | Readonly<{ kind: "project" }>
  | Readonly<{ kind: "edit"; scope: EditScope }>;

const SUMMARY: Readonly<Record<CliAccess["kind"], string>> = {
  names:
    "Files are empty placeholders: list and search file names with commands such as find, ls or rg --files. Contents are not available.",
  files: "Only the selected files exist. The project is read-only.",
  project: "The whole project is read-only.",
  edit: "Edits apply to a staged copy and are validated against your assignment.",
};

/** The only tool any model gets. Permissions are enforced by what is mounted, not by parsing. */
export class CliTool implements ITool {
  readonly argumentsContract = new JoiArgumentsContract(
    "cli-arguments",
    Joi.object({ command: Joi.string().min(1).max(8192).required() }),
  );
  readonly resultContract = new JsonValueContract();
  readonly descriptor = {
    id: "cli",
    version: "2",
    description:
      'cli {"command":"shell command"}: runs /bin/sh at /workspace in an isolated Linux environment without network.',
    inputSchema: this.argumentsContract.schema,
    maxArgumentBytes: 16_384,
    maxOutputBytes: 65_536,
  };

  constructor(
    private readonly copy: WorkingCopy,
    private readonly cli: ICliExecutor,
    private readonly access: CliAccess,
    private readonly artifacts: RunArtifacts,
  ) {}

  describe(): string {
    const scope = this.access.kind === "edit" ? ` ${this.access.scope.describe()}` : "";
    return `${this.descriptor.description} ${SUMMARY[this.access.kind]}${scope}`;
  }

  async execute(input: JsonValue, context: IExecutionContext): Promise<JsonValue> {
    try {
      const { command } = input as { command: string };
      const result = await this.cli.run(
        {
          command: ["/bin/sh", "-c", command],
          mounts: await this.mounts(),
          workingDirectory: "/workspace",
        },
        context,
      );
      const rejected = await this.rejectOutsideScope();
      return {
        exitCode: result.exitCode,
        output: result.output,
        truncated: result.truncated,
        timedOut: result.timedOut,
        revision: await this.copy.revision(),
        ...(rejected.length
          ? { rejected: `Restored, outside your assignment: ${rejected.join(", ")}` }
          : {}),
        ...(result.truncated
          ? { logRef: await this.artifacts.log("CLI output", command, result.log) }
          : {}),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "The CLI failed." };
    }
  }

  private async mounts(): Promise<readonly CliMount[]> {
    switch (this.access.kind) {
      case "names":
        return this.copy.nameMounts();
      case "files":
        return this.copy.fileMounts(this.access.paths);
      case "project":
        return this.copy.directoryMounts(false, false);
      case "edit":
        return this.copy.directoryMounts(true, true);
    }
  }

  private async rejectOutsideScope(): Promise<readonly string[]> {
    if (this.access.kind !== "edit") return [];
    const { changes, invalid } = await this.copy.stagedChanges();
    const rejected = [...this.access.scope.outside(changes), ...invalid];
    for (const file of rejected) await this.copy.restore(file);
    return rejected;
  }
}
