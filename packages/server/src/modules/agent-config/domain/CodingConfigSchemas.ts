import { z } from "zod";

const count = (max: number) => z.number().int().min(0).max(max);
const model = z.string().trim().max(256);
const relativeDirectory = z
  .string()
  .max(240)
  .regex(/^(?:\.|(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_.@/-]+)$/, {
    error: "Use a directory inside the project.",
  });
const executable = z.string().trim().min(1).max(256);
const argumentsList = z.array(z.string().max(1024)).max(32);

const limits = z
  .object({
    clarifications: count(16),
    investigationReturns: count(16),
    planRevisions: count(16),
    skeletonRevisions: count(16),
    codeFixReturns: count(16),
    totalReturns: count(32),
    answerRounds: z.number().int().min(1).max(8),
    runMinutes: z.number().int().min(1).max(230),
    modelCalls: z.number().int().min(1).max(5000),
    inputTokens: z.number().int().min(1000).max(100_000_000),
  })
  .strict();

const testSuite = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
    type: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(100),
    command: executable,
    args: argumentsList,
    workingDirectory: relativeDirectory,
    timeoutMs: z.number().int().min(1000).max(3_600_000),
    enabled: z.boolean(),
  })
  .strict();

/** The coding agent's project settings. Checked here as well as in the UI. */
export const codingSettingsSchema = z
  .object({
    limits,
    models: z
      .object({
        default: model,
        investigationPlanning: model,
        implementation: model,
        guardReview: model,
        skillScheduler: model,
        answer: model,
      })
      .strict(),
    testWritingPrompt: z.string().max(8000),
    testTypes: z.array(z.string().trim().min(1).max(64)).max(16),
    testSuites: z.array(testSuite).max(32),
  })
  .strict()
  .refine(
    (value) => new Set(value.testSuites.map((suite) => suite.id)).size === value.testSuites.length,
    {
      error: "Test suite IDs must be unique.",
    },
  );

const selection = z.enum(["automatic", "required", "off"]);
const name = z.string().trim().min(1).max(100);
const purpose = z.string().trim().min(1).max(1000);

export const skillContentSchema = z
  .object({
    name,
    purpose,
    instructions: z.string().trim().min(1).max(32_000),
    phases: z
      .array(z.enum(["planning", "test-writing", "skeleton", "implementation", "answer"]))
      .min(1),
    dependencies: z.array(z.uuid()).max(16),
    requiredInputs: z
      .array(z.enum(["findings", "plan", "tests", "skeleton", "approval"]))
      .max(5)
      .default([]),
    expectedResult: z.string().trim().max(2000),
    selection,
    model: model.default(""),
  })
  .strict();

const guardCommand = z
  .object({
    command: z.string().trim().max(256),
    args: argumentsList,
    script: z.string().max(8000),
    workingDirectory: relativeDirectory,
    timeoutMs: z.number().int().min(1000).max(3_600_000),
    successExitCodes: z.array(z.number().int().min(0).max(255)).min(1).max(16),
  })
  .strict()
  .refine((value) => !value.command !== !value.script.trim(), {
    error: "Configure either a command or a script.",
  });

export const guardContentSchema = z
  .object({
    name,
    purpose,
    type: z.enum(["deterministic", "llm", "combined"]),
    phases: z
      .array(z.enum(["skeleton", "guards"]))
      .min(1)
      .default(["guards"]),
    selection,
    blocking: z.boolean(),
    reviewInstructions: z.string().max(32_000),
    model,
    check: guardCommand.nullable(),
  })
  .strict()
  .refine((value) => value.type === "llm" || value.check !== null, {
    error: "A deterministic guard needs a command or script.",
  })
  .refine((value) => value.type === "deterministic" || value.reviewInstructions.trim() !== "", {
    error: "An LLM guard needs review instructions.",
  });
