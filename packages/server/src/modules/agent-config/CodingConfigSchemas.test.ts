import { describe, expect, it } from "vitest";
import {
  codingSettingsSchema,
  guardContentSchema,
  skillContentSchema,
} from "./domain/CodingConfigSchemas.js";

const settings = {
  limits: {
    clarifications: 2,
    investigationReturns: 3,
    planRevisions: 2,
    skeletonRevisions: 3,
    codeFixReturns: 3,
    totalReturns: 8,
    answerRounds: 3,
    runMinutes: 60,
    modelCalls: 300,
    inputTokens: 6_000_000,
  },
  models: {
    default: "",
    investigationPlanning: "",
    implementation: "",
    guardReview: "",
    skillScheduler: "",
    answer: "",
  },
  testWritingPrompt: "Cover the edges.",
  testTypes: ["unit"],
  testSuites: [
    {
      id: "unit",
      type: "unit",
      name: "Unit",
      command: "npm",
      args: ["test"],
      workingDirectory: ".",
      timeoutMs: 60_000,
      enabled: true,
    },
  ],
};

const guard = {
  name: "ESLint",
  purpose: "Lints.",
  type: "deterministic",
  selection: "required",
  blocking: true,
  reviewInstructions: "",
  model: "",
  check: {
    command: "npm",
    args: ["run", "lint", "--", "--max-warnings=0"],
    script: "",
    workingDirectory: ".",
    timeoutMs: 120_000,
    successExitCodes: [0],
  },
};

describe("coding configuration", () => {
  it("accepts the proposed defaults", () => {
    expect(codingSettingsSchema.safeParse(settings).success).toBe(true);
    expect(guardContentSchema.safeParse(guard).success).toBe(true);
  });

  it("rejects limits outside their range and unknown fields", () => {
    const limits = { ...settings.limits, totalReturns: 33 };
    expect(codingSettingsSchema.safeParse({ ...settings, limits }).success).toBe(false);
    const negative = { ...settings.limits, codeFixReturns: -1 };
    expect(codingSettingsSchema.safeParse({ ...settings, limits: negative }).success).toBe(false);
    expect(codingSettingsSchema.safeParse({ ...settings, extra: true }).success).toBe(false);
  });

  it("keeps commands inside the project", () => {
    const suite = { ...settings.testSuites[0], workingDirectory: "../other" };
    expect(codingSettingsSchema.safeParse({ ...settings, testSuites: [suite] }).success).toBe(
      false,
    );
    const check = { ...guard.check, workingDirectory: "/etc" };
    expect(guardContentSchema.safeParse({ ...guard, check }).success).toBe(false);
  });

  it("needs a command for a deterministic guard and instructions for a review", () => {
    expect(guardContentSchema.safeParse({ ...guard, check: null }).success).toBe(false);
    expect(guardContentSchema.safeParse({ ...guard, type: "llm" }).success).toBe(false);
    const both = { ...guard.check, script: "echo hi" };
    expect(guardContentSchema.safeParse({ ...guard, check: both }).success).toBe(false);
  });

  it("requires a skill to apply to a known phase", () => {
    const skill = {
      name: "Find packages",
      purpose: "Finds packages.",
      instructions: "Compare packages.",
      phases: ["planning"],
      dependencies: [],
      expectedResult: "A recommendation.",
      selection: "automatic",
    };
    expect(skillContentSchema.safeParse(skill).success).toBe(true);
    expect(skillContentSchema.safeParse({ ...skill, phases: ["deploy"] }).success).toBe(false);
    expect(skillContentSchema.safeParse({ ...skill, phases: [] }).success).toBe(false);
    expect(skillContentSchema.safeParse({ ...skill, phases: ["answer"] }).success).toBe(true);
    expect(skillContentSchema.safeParse({ ...skill, requiredInputs: ["nope"] }).success).toBe(
      false,
    );
    // Definitions saved before these fields existed still validate.
    expect(skillContentSchema.parse(skill)).toMatchObject({ requiredInputs: [], model: "" });
  });
});
