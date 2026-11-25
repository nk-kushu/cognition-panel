import { describe, expect, it } from "vitest";
import { receivesProviderCredentials } from "./application/AgentRunService.js";

describe("provider credentials", () => {
  it("are passed to the bundled agents that call OpenRouter, research and the cognition router included", () => {
    expect(["coding", "idea-planner", "research", "cognition"].map(receivesProviderCredentials)).toEqual([true, true, true, true]);
  });

  it("are not passed to other agents", () => {
    expect(receivesProviderCredentials("echo")).toBe(false);
  });
});
