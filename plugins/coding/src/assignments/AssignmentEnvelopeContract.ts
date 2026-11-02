import type Joi from "joi";

import type { IResultContract, ValidationResult } from "kushibot";
import type { AssignmentEnvelope } from "./AssignmentEnvelope";

/** Validates the envelope and, for `done`, the assignment's own result schema. */
export class AssignmentEnvelopeContract<TResult> implements IResultContract<
  AssignmentEnvelope<TResult>
> {
  readonly id = "coding-assignment";
  readonly version = "1";

  constructor(private readonly result: Joi.Schema) {}

  async validate(raw: unknown): Promise<ValidationResult<AssignmentEnvelope<TResult>>> {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      return this.invalid("The final value must be an object.");
    const value = raw as Record<string, unknown>;
    const texts = (list: unknown): list is readonly string[] =>
      Array.isArray(list) && list.every((item) => typeof item === "string");
    const text = (item: unknown): item is string => typeof item === "string" && !!item.trim();
    if (value.status === "done") {
      const checked = this.result.validate(value.result, { convert: false });
      if (checked.error) return this.invalid(checked.error.message);
      const inform = value.inform ?? [];
      if (!texts(inform)) return this.invalid('"inform" must be a list of strings.');
      return {
        valid: true,
        value: { status: "done", result: checked.value as TResult, inform: inform.slice(0, 8) },
      };
    }
    if (value.status === "needs-information") {
      if (!text(value.question) || !text(value.why))
        return this.invalid('"question" and "why" are required.');
      if (value.route !== "repository" && value.route !== "design")
        return this.invalid('"route" must be repository or design.');
      return {
        valid: true,
        value: {
          status: "needs-information",
          question: value.question.slice(0, 900),
          why: value.why.slice(0, 900),
          checked: texts(value.checked) ? value.checked.slice(0, 16) : [],
          route: value.route,
        },
      };
    }
    if (value.status === "needs-decision") {
      const choices = (Array.isArray(value.choices) ? value.choices : []).filter(
        (choice): choice is { label: string; packages?: unknown } =>
          text((choice as { label?: unknown })?.label),
      );
      if (!text(value.question) || choices.length < 1 || choices.length > 8)
        return this.invalid('"question" and 1-8 "choices" are required.');
      return {
        valid: true,
        value: {
          status: "needs-decision",
          question: value.question.slice(0, 2000),
          findings: text(value.findings) ? value.findings.slice(0, 8000) : "",
          recommendation: text(value.recommendation) ? value.recommendation.slice(0, 2000) : "",
          choices: choices.map((choice) => ({
            label: choice.label.slice(0, 200),
            packages: texts(choice.packages) ? choice.packages.slice(0, 8) : [],
          })),
        },
      };
    }
    return this.invalid('"status" must be done, needs-information or needs-decision.');
  }

  private invalid(message: string): ValidationResult<AssignmentEnvelope<TResult>> {
    return { valid: false, issues: [{ path: [], code: "INVALID_ASSIGNMENT_RESULT", message }] };
  }
}
