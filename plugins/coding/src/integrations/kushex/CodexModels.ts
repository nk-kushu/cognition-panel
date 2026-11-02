import { CodexCliTextGatewayFactory, type ModelProfile } from "kushibot";

import type { IModelBindings, ModelRole } from "../../CodingAgentOptions";

import { type CodingSettings } from "../../engineering/types";

export class CodexModels implements IModelBindings {
  private readonly factory = new CodexCliTextGatewayFactory({
    executable: process.env.CODEX_EXECUTABLE || undefined,
    codexHome: process.env.CODEX_HOME || undefined,
  });

  constructor(private readonly settings: CodingSettings) {}

  bind(role: ModelRole, override?: string) {
    const { models } = this.settings;
    const modelId =
      override || models[role] || models.default || process.env.CODEX_MODEL || "gpt-6.1-sol";
    const profile: ModelProfile = {
      id: `coding-${role}`,
      providerId: "codex-cli",
      modelId,
      contextTokens: 400_000,
      maxOutputTokens: 16_000,
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 1_048_576,
      supportsPromptCacheKey: false,
    };
    return { gateway: this.factory.create(profile), profile };
  }
}
