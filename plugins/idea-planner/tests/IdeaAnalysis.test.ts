import assert from "node:assert/strict";
import { test } from "node:test";
import { IdeaAnalysisCapability } from "../src/capabilities/IdeaAnalysisCapability";

test("the idea analysis asks for one template per reply, because the agent accepts one JSON action per reply", () => {
  const instructions = new IdeaAnalysisCapability().instructions();
  assert.match(instructions, /one template per reply/);
  assert.match(instructions, /never put two tool calls in one reply/);
  assert.match(instructions, /Call list_templates once/);
});
