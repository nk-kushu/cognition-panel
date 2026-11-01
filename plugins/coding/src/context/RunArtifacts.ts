import { createHash } from "node:crypto";
import type {
  AgentRunRuntime,
  ArtifactRef,
  GuardCheckInput,
  IArtifactWriter,
  IExecutionContext,
  IGuardEvidenceVerifier,
  JsonValue,
} from "kushibot";

/** Saved evidence. Every artifact says what it is and how it relates to the user's goal. */
export class RunArtifacts implements IGuardEvidenceVerifier {
  private readonly saved = new Map<string, { revision: string; reference: ArtifactRef }>();

  constructor(
    private readonly writer: IArtifactWriter,
    private readonly runtime: AgentRunRuntime,
    private readonly goal: string,
  ) {}

  /** Saves JSON with a readable label; returns its `artifact:<id>` reference. */
  async record(label: string, relation: string, value: unknown, revision = "run"): Promise<string> {
    const data = JSON.stringify({ label, relation, goal: this.goal.slice(0, 500), value });
    return this.write(label, "application/json", data, revision);
  }

  async log(label: string, command: string, output: string): Promise<string> {
    return this.write(label, "text/plain", `$ ${command}\n${output}`.slice(0, 1_000_000), "run");
  }

  async verify(
    refs: readonly string[],
    input: GuardCheckInput,
    context: IExecutionContext,
  ): Promise<boolean> {
    context.signal.throwIfAborted();
    return (
      refs.length > 0 &&
      refs.every((ref) => this.saved.get(ref)?.revision === input.target.revisionRef)
    );
  }

  evidence(): Readonly<Record<string, JsonValue>> {
    return Object.fromEntries(
      [...this.saved].map(([ref, record]) => [ref, { ...record.reference }]),
    );
  }

  private async write(
    label: string,
    mediaType: string,
    data: string,
    revision: string,
  ): Promise<string> {
    const digest = createHash("sha256").update(data).digest("hex");
    const reference = await this.writer.write(
      {
        name: label.slice(0, 128),
        kind: "coding-evidence",
        mediaType,
        schemaId: "coding-evidence",
        schemaVersion: "1",
        sourceRefs: [],
        idempotencyKey: `coding:${this.runtime.context.identity.runId}:${digest}`,
        expiresAtEpochMs: null,
        data: new TextEncoder().encode(data),
      },
      this.runtime.context.signal,
    );
    const ref = `artifact:${reference.artifactId}`;
    this.saved.set(ref, { revision, reference });
    this.runtime.debug.event("result.persisted", "info", {
      operation: "coding.artifact",
      summary: label.slice(0, 256),
      relatedRefs: [ref],
    });
    return ref;
  }
}
