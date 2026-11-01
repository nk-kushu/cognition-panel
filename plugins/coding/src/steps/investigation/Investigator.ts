import Joi from "joi";
import type { IExecutionContext } from "kushibot";
import type { AssignmentRunner } from "../../assignments/AssignmentRunner";
import { decisionText, type RunContext } from "../../context/RunContext";
import type { InvestigationQuestion, SourceRef } from "../../context/RunState";
import { pathSchema } from "../instructions";

const MAX_CANDIDATES = 24;

const DISCOVERY = `Propose the project files most likely to answer one question.
Find them by name with commands such as find, ls or rg --files; file contents are not available.
Return the paths only, as {"paths":[...]}, best first, at most ${MAX_CANDIDATES}.`;

const READING = `Read the selected files and answer one question.
Report only what the code shows. Set "answered" to false when these files do not answer it, and say what is missing.
Return {"answered":true,"answer":"what the code shows","sources":["paths you relied on"],"missing":""}.`;

type Reading = Readonly<{
  answered: boolean;
  answer: string;
  sources: readonly string[];
  missing: string;
}>;

/**
 * The focused investigation used by both branches: names only, then JEV's selection, then a
 * separate session that reads exactly the selected files. A session never receives the
 * assignment to implement anything.
 */
export class Investigator {
  constructor(
    private readonly run: RunContext,
    private readonly assignments: AssignmentRunner,
  ) {}

  /** Reopens questions whose evidence came from files that have since changed. */
  async recheckFindings(): Promise<void> {
    const { state, copy } = this.run;
    const stale = new Set<string>();
    for (const finding of state.data.findings)
      for (const source of finding.sources)
        if (
          !(await copy.exists(source.path)) ||
          (await copy.fingerprintOf(source.path)) !== source.digest
        )
          stale.add(finding.questionId);
    if (stale.size === 0) return;
    await state.update((data) => {
      // Changed files hold new evidence, so reading them again is not a repeated search.
      for (const id of stale) data.searched[id] = [];
      data.findings = data.findings.filter((finding) => !stale.has(finding.questionId));
      data.questions = data.questions.map((question) =>
        stale.has(question.id) ? { ...question, status: "open" } : question,
      );
    });
  }

  /** One round over every open question; returns whether any new evidence appeared. */
  async round(context: IExecutionContext): Promise<boolean> {
    const { state } = this.run;
    let progress = false;
    for (const question of state.data.questions.filter((item) => item.status === "open"))
      if (await this.investigate(question, context)) progress = true;
    await state.update((data) => {
      data.investigationProgress = progress;
    });
    return progress;
  }

  private async investigate(
    question: InvestigationQuestion,
    context: IExecutionContext,
  ): Promise<boolean> {
    const { state, copy, artifacts } = this.run;
    const searched = state.data.searched[question.id] ?? [];
    const round = Object.keys(state.data.assignments).filter((id) =>
      id.startsWith(`investigate:discover:${question.id}:`),
    ).length;
    const { paths } = await this.assignments.execute<{ paths: readonly string[] }>(
      {
        id: `investigate:discover:${question.id}:${round}`,
        label: `Looking for files: ${question.question.slice(0, 120)}`,
        instructions: DISCOVERY,
        input: { question: question.question, why: question.why, alreadyRead: searched },
        access: { kind: "names" },
        model: "investigationPlanning",
        result: Joi.object({
          paths: Joi.array().items(pathSchema).max(MAX_CANDIDATES).required(),
        }),
      },
      context,
    );
    const known = new Set(await copy.paths());
    const candidates = [...new Set(paths)].filter((file) => known.has(file));
    const selected = await this.select(question, candidates, context);
    await artifacts.record(
      `File selection: ${question.question.slice(0, 80)}`,
      "Which files JEV judged relevant to this investigation question.",
      { question: question.question, candidates, selected },
    );
    const fresh = selected.filter((file) => !searched.includes(file));
    await state.update((data) => {
      data.searched[question.id] = [...searched, ...fresh];
    });
    if (fresh.length === 0) return false;

    const reading = await this.assignments.execute<Reading>(
      {
        id: `investigate:read:${question.id}:${round}`,
        label: `Reading ${selected.length} files: ${question.question.slice(0, 120)}`,
        instructions: READING,
        input: { question: question.question, why: question.why, selectedFiles: selected },
        access: { kind: "files", paths: selected },
        model: "investigationPlanning",
        result: Joi.object({
          answered: Joi.boolean().required(),
          answer: Joi.string().allow("").max(8000).required(),
          sources: Joi.array().items(pathSchema).max(32).required(),
          missing: Joi.string().allow("").max(2000).required(),
        }),
        validate: async (result) => {
          const outside = result.sources.filter((file) => !selected.includes(file));
          if (outside.length) return `Sources must be selected files: ${outside.join(", ")}`;
          return result.answered && result.sources.length === 0
            ? "An answer needs at least one source."
            : null;
        },
      },
      context,
    );
    if (!reading.answered) return true;
    const sources: SourceRef[] = await Promise.all(
      reading.sources.map(async (file) => ({
        path: file,
        digest: await copy.fingerprintOf(file),
      })),
    );
    const artifactRef = await artifacts.record(
      `Finding: ${question.question.slice(0, 80)}`,
      `Answers an investigation question needed for the goal: ${question.why.slice(0, 200)}`,
      { question: question.question, answer: reading.answer, sources },
    );
    await state.update((data) => {
      data.findings.push({
        questionId: question.id,
        question: question.question,
        answer: reading.answer,
        sources,
        artifactRef,
      });
      data.questions = data.questions.map((item) =>
        item.id === question.id ? { ...item, status: "answered" } : item,
      );
    });
    return true;
  }

  /** JEV chooses; an abstaining or unavailable selector keeps a candidate rather than drop it. */
  private async select(
    question: InvestigationQuestion,
    candidates: readonly string[],
    context: IExecutionContext,
  ): Promise<readonly string[]> {
    const selected: string[] = [];
    for (const file of candidates) {
      const outcome = await this.run.decide(
        {
          purpose: "select-relevant-file",
          question: "Is this file likely to help answer the investigation question?",
          options: ["relevant", "not-relevant"],
          evidence: [
            { ref: "question", text: decisionText(question.question) },
            { ref: "file", text: decisionText(file) },
          ],
        },
        context,
      );
      if (outcome.status !== "answered" || outcome.answer.choice === "relevant")
        selected.push(file);
    }
    return selected;
  }
}
