import assert from "node:assert/strict";
import { test } from "node:test";
import { FINAL_ANSWER_RULE } from "../src/AssistantAgent";
import { AssistantAnswerContract } from "../src/AssistantRequest";

test("the rule names the one accepted shape and forbids invented fields", () => {
  assert.match(FINAL_ANSWER_RULE, /\{"kind":"final","value":\{"answer":"<markdown>"\}\}/);
  assert.match(FINAL_ANSWER_RULE, /ONE Markdown string/);
  assert.match(FINAL_ANSWER_RULE, /anything but "answer" is rejected/);
});

test("the contract accepts exactly what the rule describes, and rejects the structured object a model once invented", async () => {
  const contract = new AssistantAnswerContract();
  assert.equal((await contract.validate({ answer: "## The idea in brief\n- a" })).valid, true);
  const invented = await contract.validate({ idea: "x", users: "y", coreFeatures: ["a"], templates: [], missing: [], order: [] });
  assert.equal(invented.valid, false);
  if (!invented.valid) assert.match(invented.issues[0]!.message, /Return \{"answer": "<markdown>"\}/);
});
