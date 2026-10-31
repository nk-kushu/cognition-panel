import {
  type AgentRunRuntime,
  type ArtifactRef,
  type ArtifactWriteRequest,
  type IArtifactWriter,
  type GuardCheckInput,
  type IExecutionContext,
  type IGuardEvidenceVerifier,
  type JsonValue,
} from "kushibot";

type Change = Readonly<{ path: string; before: string | null; after: string | null }>;

/** Keeps review inputs and host-written reports addressable by verified artifact references. */
export class CodingReviewArtifacts implements IArtifactWriter, IGuardEvidenceVerifier {
  private readonly changes = new Map<string, Change>();
  private readonly records = new Map<string, { revision: string; reference: ArtifactRef }>();
  constructor(
    private readonly writer: IArtifactWriter,
    private readonly runtime: AgentRunRuntime,
  ) {}
  async write(request: ArtifactWriteRequest, signal?: AbortSignal): Promise<ArtifactRef> {
    const reference = await this.writer.write(request, signal);
    if (request.kind === "workspace-change") {
      this.changes.set(
        `artifact:${reference.artifactId}`,
        JSON.parse(Buffer.from(request.data).toString("utf8")) as Change,
      );
    }
    return reference;
  }
  reviewChanges(refs: readonly string[]): readonly Change[] {
    return refs.map((ref) => {
      const change = this.changes.get(ref);
      if (!change) throw new Error("Review change evidence is unavailable.");
      return change;
    });
  }
  async record(name: string, value: unknown, revision: string): Promise<string> {
    const reference = await this.writer.write(
      {
        name,
        kind: "coding-engineering",
        mediaType: "application/json",
        schemaId: name,
        schemaVersion: "1",
        sourceRefs: [revision],
        idempotencyKey: `engineering:${this.runtime.ids.nextId()}`,
        expiresAtEpochMs: null,
        data: Buffer.from(JSON.stringify(value)),
      },
      this.runtime.context.signal,
    );
    const ref = `artifact:${reference.artifactId}`;
    this.records.set(ref, { revision, reference });
    this.runtime.debug.event("result.persisted", "info", {
      operation: name,
      relatedRefs: [ref, revision],
    });
    return ref;
  }
  async verify(
    refs: readonly string[],
    input: GuardCheckInput,
    context: IExecutionContext,
  ): Promise<boolean> {
    context.signal.throwIfAborted();
    return (
      refs.length > 0 &&
      refs.every((ref) => this.records.get(ref)?.revision === input.target.revisionRef)
    );
  }
  evidence(): Readonly<Record<string, JsonValue>> {
    return Object.fromEntries(
      [...this.records].map(([ref, record]) => [ref, { ...record.reference }]),
    );
  }
}
