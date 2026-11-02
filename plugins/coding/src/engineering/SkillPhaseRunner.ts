import Joi from "joi";
import { SkillScheduler, type IExecutionContext, type SkillDescriptor } from "kushibot";
import type { AssignmentRunner } from "../assignments/AssignmentRunner";
import { StepStopped } from "../assignments/StepStopped";
import { decisionText, type RunContext } from "../context/RunContext";
import type { SkillDefinition, SkillPhase } from "./types";

const scheduled = (skill: SkillDefinition): boolean =>
  skill.selection !== "off" && skill.expectedResult.trim() !== "";

/**
 * Runs a phase's skills inside its step. The library scheduler picks the next one, a separate
 * session performs it, and the result is saved before the next choice, so a run that waits
 * for a human continues from recorded progress. Skills with no expected result are short
 * guidance that travels with the phase's assignments instead of costing a session.
 */
export class SkillPhaseRunner {
  private readonly skills: readonly SkillDefinition[];

  constructor(
    private readonly run: RunContext,
    private readonly assignments: AssignmentRunner,
  ) {
    this.skills = run.pinned.skills;
  }

  guidance(phase: SkillPhase): readonly string[] {
    return this.skills
      .filter(
        (skill) => skill.selection !== "off" && !scheduled(skill) && skill.phases.includes(phase),
      )
      .map((skill) => `${skill.name}: ${skill.instructions}`);
  }

  async execute(phase: SkillPhase, context: IExecutionContext): Promise<void> {
    const { runtime, models, state, pinned } = this.run;
    const candidates = this.skills.filter(scheduled);
    if (!candidates.some((skill) => skill.phases.includes(phase))) return;
    const model = models.bind("skillScheduler");
    const scheduler = new SkillScheduler(
      runtime.createModelCall(model),
      model.profile,
      runtime.clock,
    );
    const descriptors: readonly SkillDescriptor[] = candidates.map((skill) => ({
      id: skill.id,
      name: skill.name,
      purpose: skill.purpose,
      phases: skill.phases,
      dependencies: skill.dependencies,
      requiredInputs: skill.requiredInputs ?? [],
      selection: skill.selection === "required" ? "required" : "automatic",
    }));
    for (let turn = 0; turn <= 2 * candidates.length + 1; turn++) {
      const pending = state.data.pendingSkill;
      if (pending?.phase === phase) {
        await this.perform(
          this.skills.find((skill) => skill.id === pending.skillId)!,
          phase,
          context,
        );
        continue;
      }
      const outcome = await scheduler.next(
        {
          goal: pinned.message.slice(0, 2000),
          phase,
          skills: descriptors,
          completed: state.data.skillResults.map(({ skillId, summary, phase: ran }) => ({
            skillId,
            summary,
            phase: ran,
          })),
          availableInputs: this.availableInputs(),
        },
        this.run.control(context),
      );
      if (outcome.status === "stopped") throw new StepStopped(outcome.reason);
      if (outcome.status === "uncertain")
        throw new StepStopped(
          { code: "no-progress", message: "A scheduling call has an unknown result." },
          [outcome.operationId],
        );
      if (outcome.status === "blocked")
        throw new StepStopped({ code: "no-progress", message: outcome.message });
      await state.update((data) => {
        data.schedulerLog.push({
          phase,
          choice: outcome.status === "run" ? outcome.skillId : "finish",
          reason: outcome.reason,
        });
        if (outcome.status === "run") data.pendingSkill = { phase, skillId: outcome.skillId };
      });
      if (outcome.status === "finished") return;
    }
    throw new StepStopped({ code: "limit-reached", message: "Skill scheduling did not finish." });
  }

  private availableInputs(): readonly string[] {
    const { findings, plan, testsPlanDigest, skeleton, approval } = this.run.state.data;
    return [
      findings.length > 0 && "findings",
      plan && "plan",
      testsPlanDigest && "tests",
      skeleton && "skeleton",
      approval && "approval",
    ].filter((input): input is string => typeof input === "string");
  }

  /** Why a session's result is not acceptable yet; JEV being unavailable does not block it. */
  private async resultProblem(
    skill: SkillDefinition,
    result: unknown,
    context: IExecutionContext,
  ): Promise<string | null> {
    const text = JSON.stringify(result) ?? "";
    if (["null", '""', "{}", "[]", ""].includes(text))
      return `The result is empty. Expected: ${skill.expectedResult}`;
    try {
      const outcome = await this.run.decide(
        {
          purpose: "check-skill-result",
          question: "Does this result provide what the skill promised?",
          options: ["meets-expected-result", "misses-expected-result"],
          evidence: [
            { ref: "expected", text: decisionText(skill.expectedResult) },
            { ref: "result", text: decisionText(text) },
          ],
        },
        context,
      );
      return outcome.status === "answered" && outcome.answer.choice === "misses-expected-result"
        ? `The result does not provide what was expected: ${skill.expectedResult}`
        : null;
    } catch (error) {
      if (error instanceof StepStopped) return null;
      throw error;
    }
  }

  private async perform(
    skill: SkillDefinition,
    phase: SkillPhase,
    context: IExecutionContext,
  ): Promise<void> {
    const { state } = this.run;
    const { summary, result } = await this.assignments.execute<{
      summary: string;
      result: unknown;
    }>(
      {
        id: `skill:${skill.versionId}:${phase}`,
        label: `Running skill: ${skill.name}.`,
        instructions: `${skill.instructions}\n\nExpected result: ${skill.expectedResult}\nReturn {"summary":"one or two sentences","result":<the expected result>}.`,
        input: {
          findings: this.run.findings(),
          earlierSkills: state.data.skillResults.map((item) => ({
            skill: item.skillId,
            summary: item.summary,
            result: item.result as never,
          })),
        },
        access: { kind: "project" },
        model: "default",
        ...(skill.model ? { modelId: skill.model } : {}),
        result: Joi.object({
          summary: Joi.string().min(1).max(1000).required(),
          result: Joi.any().required(),
        }),
        validate: ({ result: value }) => this.resultProblem(skill, value, context),
      },
      context,
    );
    await this.run.artifacts.record(
      `Skill result: ${skill.name}`,
      `Output of the ${skill.name} skill for the ${phase} phase.`,
      { summary, result },
    );
    await state.update((data) => {
      data.skillResults.push({
        skillId: skill.id,
        versionId: skill.versionId,
        phase,
        summary,
        result,
      });
      data.pendingSkill = null;
    });
  }
}
