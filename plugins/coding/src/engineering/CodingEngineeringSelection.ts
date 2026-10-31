import {
  ConservativeGuardSelectionPolicy,
  GuardSelectionService,
  type AgentRunRuntime,
  type GuardRegistry,
  type GuardSelection,
  type IDecisionUnit,
} from "kushibot";
import type { CodingEngineeringDefinition } from "./types";
import type { CodingReviewArtifacts } from "./CodingReviewArtifacts";

/** Skills use task evidence; guard applicability is reevaluated against every proposed revision. */
export class CodingEngineeringSelection {
  constructor(
    private readonly definitions: readonly CodingEngineeringDefinition[],
    private readonly decisions: IDecisionUnit,
    private readonly runtime: AgentRunRuntime,
    private readonly artifacts: CodingReviewArtifacts,
    private readonly timeoutMs: number,
  ) {}

  async skills(goal: string): Promise<string> {
    const selected: CodingEngineeringDefinition[] = [];
    const entries: { id: string; status: string; included: boolean }[] = [];
    await this.runtime.context.reporter.progress("Selecting coding skills with DecisionUnit.");
    for (const definition of this.definitions) {
      if (definition.skillMode === "off") continue;
      let included = definition.skillMode === "required";
      let status = "required";
      if (!included) {
        const outcome = await this.decisions.evaluate(
          {
            purpose: "select-coding-skill",
            question: this.bounded(
              definition.skillQuestion || `Would ${definition.label} guidance help this task?`,
              1000,
            ),
            options: ["include", "exclude"],
            evidence: [
              { ref: "task:goal", text: this.bounded(goal, 1000) },
              { ref: `skill:${definition.id}`, text: this.bounded(definition.description, 1000) },
            ],
          },
          this.control(),
        );
        status = outcome.status;
        if (outcome.status === "stopped" || outcome.status === "uncertain")
          throw new Error(`Skill selection stopped: ${definition.id} (${outcome.status}).`);
        // An unavailable/abstaining selector never silently drops guidance.
        included = outcome.status !== "answered" || outcome.answer.choice === "include";
      }
      entries.push({ id: definition.id, status, included });
      if (included) selected.push(definition);
    }
    await this.artifacts.record("coding-skill-selection", entries, "task:initial");
    await this.runtime.context.reporter.progress(
      `Selected skills: ${selected.map((item) => item.label).join(", ") || "none"}.`,
    );
    return selected.map((item) => `Skill: ${item.label}\n${item.skillInstructions}`).join("\n\n");
  }

  async guards(
    registry: GuardRegistry,
    summary: string,
    revision: string,
  ): Promise<GuardSelection> {
    const service = new GuardSelectionService(
      registry,
      this.decisions,
      new ConservativeGuardSelectionPolicy(true),
      this.runtime.ids,
      this.runtime.clock,
    );
    const enabled = this.definitions.filter((item) => item.guardMode !== "off");
    const selections: GuardSelection[] = [];
    // Each batch stays within the library's eight required/eight optional candidate limits.
    for (let offset = 0; offset < enabled.length; offset += 8) {
      const batch = enabled.slice(offset, offset + 8);
      const result = await service.select(
        batch.filter((item) => item.guardMode === "required").map((item) => item.id),
        batch.filter((item) => item.guardMode === "auto").map((item) => item.id),
        this.bounded(summary, 1000),
        this.control(),
      );
      await this.artifacts.record("coding-guard-selection", result, revision);
      if (
        result.stopReason ||
        result.selection.pendingOperationRefs.length ||
        result.selection.unresolvedGuardIds.length
      )
        throw new Error("Guard selection is incomplete; implementation cannot be accepted.");
      selections.push(result.selection);
    }
    return {
      schemaVersion: 1,
      guards: selections.flatMap((item) => [...item.guards]),
      unresolvedGuardIds: [],
      pendingOperationRefs: [],
    };
  }
  private control() {
    return {
      operationId: this.runtime.ids.nextId(),
      signal: this.runtime.context.signal,
      deadlineEpochMs: this.runtime.context.deadlineEpochMs,
      timeoutMs: this.timeoutMs,
    };
  }
  private bounded(value: string, bytes: number): string {
    const clean =
      [...value]
        .map((char) => (char.charCodeAt(0) < 32 ? " " : char))
        .join("")
        .trim() || "No details supplied.";
    return [...clean].reduce(
      (result, char) => (Buffer.byteLength(result + char) <= bytes ? result + char : result),
      "",
    );
  }
}
