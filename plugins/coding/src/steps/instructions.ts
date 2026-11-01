import Joi from "joi";

/** A project-relative path as a model reports it. */
export const pathSchema = Joi.string()
  .max(240)
  .pattern(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/);

export const summarySchema = Joi.object({ summary: Joi.string().min(1).max(2000).required() });

export const guidanceFor = (guidance: readonly string[]): string =>
  guidance.length ? `Project guidance:\n${guidance.join("\n\n")}` : "";
