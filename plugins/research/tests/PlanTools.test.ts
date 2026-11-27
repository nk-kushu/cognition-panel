import assert from "node:assert/strict";
import { test } from "node:test";
import { CognitionRejected } from "../src/CognitionClient";
import { CapabilityRegistry } from "../src/capabilities/CapabilityRegistry";
import { ResearchTools, RunTally, type ResearchToolId } from "../src/ResearchTools";
import { ToolBox } from "../src/ToolBox";

const PLAN_TOOLS: ResearchToolId[] = ["research_overview", "read_idea", "business_plan_overview", "save_business_plan"];

const PLAN = {
  version: 1,
  createdBy: "agent",
  readiness: { confirmed: 2, hypothesis: 3, missing: 4 },
  blocks: [{ key: "problem", status: "confirmed", gap: null, statements: [{ text: "Салоните губят време", support: "confirmed", citations: [{ findingId: "f1" }] }] }],
  currency: "EUR",
  inputs: [{ key: "price", value: 29, kind: "fact", source: "f2", note: "" }],
  scenarios: [{ key: "base", breakEvenMonth: 9, profitableMonth: 3, months: Array.from({ length: 24 }, (_, index) => ({ month: index + 1, revenue: 100 * (index + 1), profit: 10, cumulative: index * 10 })) }],
};

function setup(routes: Record<string, (body?: unknown) => unknown>, limits?: { planSaves: number }) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const handle = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    if (!route) throw new Error(`unexpected ${method} ${path}`);
    return route(body);
  };
  const client = {
    get: <T>(path: string) => handle("GET", path) as Promise<T>,
    post: <T>(path: string, body: unknown) => handle("POST", path, body) as Promise<T>,
    patch: <T>(path: string, body: unknown) => handle("PATCH", path, body) as Promise<T>,
  };
  const tally = new RunTally();
  const box = new ToolBox([new ResearchTools(client, "app-1", () => {}, tally, PLAN_TOOLS, limits)]);
  const call = async (toolId: string, args: Record<string, unknown> = {}) =>
    ((await box.dispatch({ operationId: "op", toolId, arguments: args } as never)) as { observation: { value: Record<string, any> } }).observation.value;
  return { calls, tally, call };
}

test("read_idea returns the idea's content and clarity", async () => {
  const run = setup({ "GET /local-apps/app-1/idea": () => ({ clear: true, missing: [], version: 3, content: { summary: "Booking for salons" }, assumptions: [] }) });
  assert.deepEqual(await run.call("read_idea"), { clear: true, missing: [], version: 3, content: { summary: "Booking for salons" } });
});

test("research_overview now carries a finding's fact, and leaves empty facts out", async () => {
  const run = setup({
    "GET /local-apps/app-1/research": () => ({
      stages: [{ key: "monetization", percent: 50, checks: [], blockers: [], sections: [{ key: "monetization.competitor_pricing", findings: [
        { findingId: "f2", status: "accepted", evidence: "confirmed", statement: "Treatwell 29 EUR", fact: { competitor: "Treatwell", price: 29, currency: "EUR", period: "month", plan: "Pro" } },
        { findingId: "f3", status: "accepted", evidence: "confirmed", statement: "x", fact: {} },
      ] }] }],
      featuresToDrop: [],
    }),
  });
  const findings = (await run.call("research_overview")).findings;
  assert.equal(findings[0].fact.price, 29);
  assert.equal("fact" in findings[1], false);
});

test("business_plan_overview hands over the preflight and the assumptions flag", async () => {
  const preflight = { canWrite: true, acceptedFindings: 4, missing: [{ section: "monetization.buyer" }], message: "No buyer defined." };
  const run = setup({ "GET /local-apps/app-1/business-plan": () => ({ plan: { ...PLAN, allInputsAssumptions: true }, preflight, versions: 1, blocks: [] }) });
  const answer = await run.call("business_plan_overview");
  assert.deepEqual(answer.preflight, preflight);
  assert.equal(answer.plan.allInputsAssumptions, true);
});

test("business_plan_overview summarizes the plan without the monthly table", async () => {
  const run = setup({ "GET /local-apps/app-1/business-plan": () => ({ plan: PLAN, versions: 1, blocks: [{ key: "problem" }] }) });
  const answer = await run.call("business_plan_overview");
  assert.equal(answer.plan.scenarios[0].breakEvenMonth, 9);
  assert.equal(answer.plan.scenarios[0].month12Revenue, 1200);
  assert.equal("months" in answer.plan.scenarios[0], false);
  assert.deepEqual(answer.plan.blocks[0].statements[0].findingIds, ["f1"]);
});

test("save_business_plan posts the draft, records the version, and stops after the per-run limit", async () => {
  const run = setup({ "POST /local-apps/app-1/business-plan/versions": () => PLAN }, { planSaves: 2 });
  const draft = { canvas: { problem: { statements: [], gap: null } }, financials: { currency: "EUR", inputs: {} } };
  assert.equal((await run.call("save_business_plan", draft)).readiness.confirmed, 2);
  assert.deepEqual(run.calls[0]!.body, draft);
  assert.equal(run.tally.planVersion, 1);
  await run.call("save_business_plan", draft);
  assert.match((await run.call("save_business_plan", draft)).error, /planSaves limit for this run \(2\) is used up/);
});

test("save_business_plan refuses a call without canvas or financials", async () => {
  const run = setup({});
  assert.match((await run.call("save_business_plan", { canvas: {} })).error, /needs canvas and financials/);
  assert.equal(run.calls.length, 0);
});

test("a citation cognition refuses comes back to the model to correct", async () => {
  const run = setup({
    "POST /local-apps/app-1/business-plan/versions": () => {
      throw new CognitionRejected("Може да се цитират само приети констатации на този app. Не са приети или не съществуват: ghost.");
    },
  });
  assert.match((await run.call("save_business_plan", { canvas: {}, financials: {} })).error, /ghost/);
});

test("the registry offers /plan, which never computes numbers itself", () => {
  const plan = CapabilityRegistry.default().command("/plan")!;
  assert.equal(plan.id, "plan");
  assert.match(plan.instructions(), /Never compute revenue, profit or break-even yourself/);
});

test("the plan instructions know the compliance cost and leave the legal part to Research", () => {
  const instructions = CapabilityRegistry.default().command("/plan")!.instructions();
  assert.match(instructions, /complianceCostPerMonth/);
  assert.match(instructions, /you do not write it/);
});

test("/plan reports the missing evidence first, refuses to write when nothing is accepted, and flags all-assumption finances", () => {
  const instructions = CapabilityRegistry.default().command("/plan")!.instructions();
  assert.match(instructions, /preflight\.canWrite is false/);
  assert.match(instructions, /never call save_business_plan/);
  assert.match(instructions, /review or collect findings in Research first/);
  assert.match(instructions, /\*\*Missing evidence:\*\* preflight\.message/);
  assert.match(instructions, /allInputsAssumptions is true/);
});
