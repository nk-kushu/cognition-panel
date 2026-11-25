import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAppId } from "../src/AppResolver";
import { CognitionClient, CognitionRejected, cognitionApiUrl, DEFAULT_COGNITION_API_URL } from "../src/CognitionClient";
import { CapabilityRegistry } from "../src/capabilities/CapabilityRegistry";
import { DOCUMENT_PART_CHARS, ResearchTools, RunTally, type ResearchToolId } from "../src/ResearchTools";
import { ToolBox } from "../src/ToolBox";

const ALL: ResearchToolId[] = ["research_overview", "list_documents", "read_document", "propose_finding", "link_findings", "set_evidence_type"];

type Call = { method: string; path: string; body?: unknown };

/** A cognition API stand-in: records calls and answers from a route table. */
function fakeClient(routes: Record<string, (body?: unknown) => unknown>) {
  const calls: Call[] = [];
  const handle = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    if (!route) throw new Error(`unexpected ${method} ${path}`);
    return route(body);
  };
  return {
    calls,
    client: {
      get: <T>(path: string) => handle("GET", path) as Promise<T>,
      post: <T>(path: string, body: unknown) => handle("POST", path, body) as Promise<T>,
      patch: <T>(path: string, body: unknown) => handle("PATCH", path, body) as Promise<T>,
    },
  };
}

function tools(routes: Record<string, (body?: unknown) => unknown>, limits?: { documentParts: number; findings: number; links: number }) {
  const fake = fakeClient(routes);
  const tally = new RunTally();
  const set = new ResearchTools(fake.client, "app-1", () => {}, tally, ALL, limits);
  return { ...fake, tally, box: new ToolBox([set]) };
}

async function callTool(box: ToolBox, toolId: string, args: Record<string, unknown>) {
  const outcome = await box.dispatch({ operationId: "op", toolId, arguments: args } as never);
  return (outcome as { observation: { value: Record<string, unknown> } }).observation.value;
}

function response(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ── App and API resolution ───────────────────────────────────────────────

test("uses configuration.appId without asking cognition for the app list", async () => {
  const { client, calls } = fakeClient({});
  assert.deepEqual(await resolveAppId({ appId: "app-9", appName: "Salon" }, "/anywhere", client), { appId: "app-9", appName: "Salon" });
  assert.equal(calls.length, 0);
});

test("matches the chat workspace to the app whose directory ends the same way", async () => {
  const { client } = fakeClient({
    "GET /local-apps": () => [
      { id: "other", name: "other", appDir: "/Users/niki/PersonalProjects/KushiBox/cognition/apps/clusters" },
      { id: "test-id", name: "test", appDir: "/Users/niki/PersonalProjects/KushiBox/cognition/apps/test" },
    ],
  });
  assert.deepEqual(await resolveAppId({}, "/roots/PersonalProjects/KushiBox/cognition/apps/test", client), { appId: "test-id", appName: "test" });
});

test("refuses a workspace that only shares its folder name with an app", async () => {
  const { client } = fakeClient({ "GET /local-apps": () => [{ id: "x", name: "test", appDir: "/Users/niki/other/test" }] });
  await assert.rejects(resolveAppId({}, "/roots/projects/elsewhere/apps/test", client), /cannot find a cognition app/);
});

test("takes the API URL from configuration, then COGNITION_API_URL, then the Docker host default", () => {
  assert.equal(cognitionApiUrl({ cognitionApiUrl: "http://cognition:3000/api/" }, { COGNITION_API_URL: "http://env/api" }), "http://cognition:3000/api");
  assert.equal(cognitionApiUrl({}, { COGNITION_API_URL: "http://env/api" }), "http://env/api");
  assert.equal(cognitionApiUrl({}, {}), DEFAULT_COGNITION_API_URL);
});

// ── Cognition client ─────────────────────────────────────────────────────

test("turns a 4xx with an error message into CognitionRejected", async () => {
  const client = new CognitionClient("http://c/api", new AbortController().signal, async () => response(400, { error: "The quote was not found." }));
  await assert.rejects(client.post("/harness/findings", {}), (error: unknown) => {
    assert.ok(error instanceof CognitionRejected);
    assert.match((error as Error).message, /The quote was not found\. \(POST \/harness\/findings, HTTP 400\)/);
    return true;
  });
});

test("stops on a 5xx and on a network error, naming the endpoint", async () => {
  const failing = new CognitionClient("http://c/api", new AbortController().signal, async () => response(502, { error: "boom" }));
  await assert.rejects(failing.get("/local-apps/a/research"), (error: unknown) => !(error instanceof CognitionRejected) && /GET \/local-apps\/a\/research/.test(String(error)));
  const offline = new CognitionClient("http://c/api", new AbortController().signal, async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(offline.get("/local-apps"), /cognition is unreachable \(GET \/local-apps at http:\/\/c\/api\)/);
});

test("a 4xx reaches the model as { error } and the run goes on", async () => {
  const { box } = tools({
    "POST /harness/findings": () => {
      throw new CognitionRejected("The quote was not found in the document.");
    },
  });
  const value = await callTool(box, "propose_finding", { documentId: "d", section: "problem.frequency", statement: "Daily", quote: "it happens every single day" });
  assert.match(String(value.error), /quote was not found/);
});

// ── Tools ────────────────────────────────────────────────────────────────

test("reads a long document in parts with nextOffset, null on the last part", async () => {
  const text = "x".repeat(DOCUMENT_PART_CHARS + 500);
  const { box } = tools({ "GET /local-apps/app-1/knowledge/documents/d1": () => ({ id: "d1", title: "Long", evidenceType: "unknown", contentMd: text }) });
  const first = await callTool(box, "read_document", { id: "d1" });
  assert.equal((first.text as string).length, DOCUMENT_PART_CHARS);
  assert.equal(first.nextOffset, DOCUMENT_PART_CHARS);
  const last = await callTool(box, "read_document", { id: "d1", offset: DOCUMENT_PART_CHARS });
  assert.equal((last.text as string).length, 500);
  assert.equal(last.nextOffset, null);
});

test("proposes a finding as an agent finding with section, fact, category and one citation", async () => {
  const { box, calls, tally } = tools({ "POST /harness/findings": () => ({ id: "f-1", status: "proposed" }) });
  const value = await callTool(box, "propose_finding", {
    documentId: "d1",
    section: "monetization.competitor_pricing",
    statement: "Acme Pro costs 29 EUR a month.",
    quote: "Acme Pro — 29 € per month",
    fact: { competitor: "Acme", plan: "Pro", price: 29, currency: "EUR", period: "month" },
    headingPath: "Pricing",
  });
  assert.deepEqual(value, { id: "f-1", status: "proposed" });
  assert.deepEqual(calls[0]!.body, {
    appId: "app-1",
    statement: "Acme Pro costs 29 EUR a month.",
    category: "competitors",
    origin: "agent",
    researchSection: "monetization.competitor_pricing",
    fact: { competitor: "Acme", plan: "Pro", price: 29, currency: "EUR", period: "month" },
    citations: [{ documentId: "d1", quote: "Acme Pro — 29 € per month", headingPath: "Pricing" }],
  });
  assert.deepEqual(tally.proposed, ["f-1"]);
});

test("refuses an unknown section without calling cognition", async () => {
  const { box, calls } = tools({});
  const value = await callTool(box, "propose_finding", { documentId: "d", section: "problem.vibes", statement: "s", quote: "a long enough quote" });
  assert.match(String(value.error), /Unknown section problem\.vibes/);
  assert.equal(calls.length, 0);
});

test("stops proposing after the findings limit, without calling cognition", async () => {
  const { box, calls } = tools({ "POST /harness/findings": () => ({ id: "f", status: "proposed" }) }, { documentParts: 30, findings: 2, links: 40 });
  const args = { documentId: "d", section: "problem.frequency", statement: "Daily", quote: "it happens every single day" };
  await callTool(box, "propose_finding", args);
  await callTool(box, "propose_finding", args);
  const third = await callTool(box, "propose_finding", args);
  assert.match(String(third.error), /findings limit for this run \(2\) is used up/);
  assert.equal(calls.length, 2);
});

test("does not change an evidence type a person already set", async () => {
  const { box, calls } = tools({
    "GET /local-apps/app-1/knowledge/documents/d1": () => ({ id: "d1", title: "G2", evidenceType: "competitor_data", contentMd: "" }),
  });
  const value = await callTool(box, "set_evidence_type", { documentId: "d1", evidenceType: "ai_brainstorm" });
  assert.match(String(value.error), /already competitor_data/);
  assert.ok(!calls.some((call) => call.method === "PATCH"));
});

test("sets the evidence type of an unclassified document", async () => {
  const { box, calls } = tools({
    "GET /local-apps/app-1/knowledge/documents/d1": () => ({ id: "d1", title: "Reddit", evidenceType: "unknown", contentMd: "" }),
    "PATCH /local-apps/app-1/research/documents/d1/evidence-type": () => ({}),
  });
  assert.deepEqual(await callTool(box, "set_evidence_type", { documentId: "d1", evidenceType: "real_user_quote" }), { evidenceType: "real_user_quote" });
  assert.deepEqual(calls.at(-1)!.body, { evidenceType: "real_user_quote" });
});

test("research_overview returns percents, failed checks, blockers and findings in short form", async () => {
  const { box } = tools({
    "GET /local-apps/app-1/research": () => ({
      stages: [
        {
          key: "problem",
          percent: 50,
          checks: [
            { id: "P1", label: "Quotes", passed: false, detail: "1 от 5" },
            { id: "P2", label: "Cost", passed: true, detail: "1" },
          ],
          blockers: [{ message: "Противоречие" }],
          sections: [{ key: "problem.cost", findings: [{ findingId: "f-1", status: "accepted", evidence: "confirmed", statement: "15 min", signal: 3, sources: [] }] }],
        },
      ],
      featuresToDrop: [{ featureId: "x", title: "AI insights" }],
      latestReport: null,
    }),
  });
  assert.deepEqual(await callTool(box, "research_overview", {}), {
    stages: [{ stage: "problem", percent: 50, failedChecks: [{ id: "P1", label: "Quotes", now: "1 от 5" }], blockers: ["Противоречие"] }],
    featuresToDrop: ["AI insights"],
    findings: [{ id: "f-1", section: "problem.cost", status: "accepted", evidence: "confirmed", statement: "15 min" }],
  });
});

// ── Commands ─────────────────────────────────────────────────────────────

test("the registry matches the manifest and picks capabilities by command", () => {
  const registry = CapabilityRegistry.default();
  assert.equal(registry.command("/analyze")?.id, "analyze");
  assert.equal(registry.command("/gaps")?.id, "gaps");
  assert.equal(registry.command("/fill-gap"), undefined);
});

test("a manifest that differs from the registry names what to add or remove", () => {
  const registry = CapabilityRegistry.default();
  assert.throws(() => registry.assertMatchesManifest(["/analyze", "/old"]), /Add: \/discover, \/gaps\. Remove: \/old\./);
});
