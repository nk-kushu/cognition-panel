import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentRuntimeFactory, type IArtifactWriter } from "kushibot";
import { CodingEngineeringConfiguration } from "../src/engineering/CodingEngineeringConfiguration";
import { codingEngineeringCatalog } from "../src/engineering/catalog";
import { CodingEngineeringModel } from "../src/engineering/CodingEngineeringModel";
import { CodingEngineeringSelection } from "../src/engineering/CodingEngineeringSelection";
import { CodingReviewArtifacts } from "../src/engineering/CodingReviewArtifacts";
import { CodingGuardReview } from "../src/engineering/CodingGuardReview";
import { WorkspaceTools } from "../src/tools/WorkspaceTools";
import { ScriptedGateway, profile } from "./fixtures/ScriptedGateway";

function configuration(overrides: Record<string, object> = {}, controls: object = {}) {
  return new CodingEngineeringConfiguration({
    ...controls,
    overrides: Object.fromEntries(
      codingEngineeringCatalog.map((item) => [
        item.id,
        { guardMode: "off", skillMode: "off", ...overrides[item.id] },
      ]),
    ),
  });
}
async function fixture(t: test.TestContext, gateway: ScriptedGateway) {
  const directory = await mkdtemp(path.join(tmpdir(), "coding-engineering-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "example.ts"), "before");
  const runtime = await new AgentRuntimeFactory({ gateway, profile, limits: { fixes: 4 } }).create(
    "coding",
  );
  let sequence = 0;
  const writes: { name: string; value: unknown }[] = [];
  const writer: IArtifactWriter = {
    async write(request) {
      writes.push({ name: request.name, value: JSON.parse(Buffer.from(request.data).toString()) });
      return {
        artifactId: `evidence-${++sequence}`,
        digest: createHash("sha256").update(request.data).digest("hex"),
        byteLength: request.data.byteLength,
        mediaType: request.mediaType,
        schemaId: request.schemaId,
        schemaVersion: request.schemaVersion,
      };
    },
  };
  const artifacts = new CodingReviewArtifacts(writer, runtime);
  const tools = new WorkspaceTools(directory, [], [], runtime, artifacts);
  await tools.initialize();
  const model = new CodingEngineeringModel(runtime, gateway, profile, 1000);
  const selection = (config: CodingEngineeringConfiguration) =>
    new CodingEngineeringSelection(
      config.settings.definitions,
      model.decisions,
      runtime,
      artifacts,
      1000,
    );
  const review = (config: CodingEngineeringConfiguration) =>
    new CodingGuardReview(
      config,
      selection(config),
      model,
      tools,
      artifacts,
      runtime,
      "Change example.ts",
    );
  const edit = async (text: string) => {
    await writeFile(path.join(directory, "example.ts"), text);
    return tools.status();
  };
  return { runtime, artifacts, tools, model, selection, review, edit, writes };
}
const include = { kind: "answered", choice: "include", supportingRefs: [] };
const exclude = { kind: "answered", choice: "exclude", supportingRefs: [] };
const passed = { verdict: "pass", findings: [] };
const blocked = {
  verdict: "fail",
  findings: [{ path: "example.ts", reason: "Add input validation." }],
};

test("configuration pins all Atlas defaults and rejects invalid controls and unknown IDs", () => {
  const config = new CodingEngineeringConfiguration();
  assert.equal(config.settings.definitions.length, 12);
  assert.equal(config.settings.definitions.filter((item) => item.skillMode === "auto").length, 5);
  assert.equal(config.version, new CodingEngineeringConfiguration().version);
  assert.notEqual(config.version, new CodingEngineeringConfiguration({ maxFixCycles: 0 }).version);
  assert.throws(() => new CodingEngineeringConfiguration({ overrides: { missing: {} } }));
  assert.throws(() => new CodingEngineeringConfiguration({ maxFixCycles: 5 }));
  assert.throws(
    () =>
      new CodingEngineeringConfiguration({ overrides: { "oop-guard": { skillMode: "required" } } }),
  );
});

test("DecisionUnit selects optional skills while required guidance cannot be excluded", async (t) => {
  const gateway = new ScriptedGateway([exclude, include]);
  const f = await fixture(t, gateway);
  const config = configuration({
    "readability-guard": { skillMode: "required" },
    "observability-guard": { skillMode: "auto" },
    "npm-library-guard": { skillMode: "auto" },
  });
  const instructions = await f.selection(config).skills("Add a package dependency");
  assert.match(instructions, /readability/i);
  assert.match(instructions, /npm|librar/i);
  assert.doesNotMatch(instructions, /Prometheus/);
  assert.equal(gateway.requests.length, 2);
  assert.ok(f.writes.some((write) => write.name === "coding-skill-selection"));
});

test("an abstaining selector includes guidance conservatively and cancellation stops selection", async (t) => {
  const gateway = new ScriptedGateway([{ kind: "abstained", supportingRefs: [] }]);
  const f = await fixture(t, gateway);
  const config = configuration({ "readability-guard": { skillMode: "auto" } });
  assert.match(await f.selection(config).skills("Rename a variable"), /readability/i);
  const controller = new AbortController();
  const runtime = await new AgentRuntimeFactory({ gateway, profile }).create("coding", {
    signal: controller.signal,
  });
  controller.abort();
  const model = new CodingEngineeringModel(runtime, gateway, profile, 1000);
  const selector = new CodingEngineeringSelection(
    config.settings.definitions,
    model.decisions,
    runtime,
    f.artifacts,
    1000,
  );
  await assert.rejects(selector.skills("Rename a variable"), /stopped/);
  assert.equal(gateway.requests.length, 1);
});

test("all twelve optional guards are selectable across bounded batches", async (t) => {
  const gateway = new ScriptedGateway([
    ...[...Array(12)].map(() => include),
    ...[...Array(12)].map(() => passed),
  ]);
  const f = await fixture(t, gateway);
  const config = new CodingEngineeringConfiguration({
    overrides: Object.fromEntries(
      codingEngineeringCatalog.map((item) => [item.id, { skillMode: "off" }]),
    ),
  });
  assert.equal((await f.review(config).apply(await f.edit("after"))).accepted, true);
  assert.equal(gateway.requests.length, 24);
  assert.equal(f.writes.filter((write) => write.name === "coding-guard-review").length, 12);
});

test("required guards always run and their blockers cause repair before acceptance", async (t) => {
  const gateway = new ScriptedGateway([blocked, passed]);
  const f = await fixture(t, gateway);
  const review = f.review(configuration({ "input-validation-guard": { guardMode: "required" } }));
  const first = await review.apply(await f.edit("unvalidated"));
  assert.equal(first.accepted, false);
  assert.match(first.feedback, /example.ts.*Add input validation/);
  const candidate = await f.edit("validated");
  assert.equal((await review.apply(candidate)).accepted, true);
  assert.equal(await review.approved(candidate), true);
  await f.edit("changed after review");
  assert.equal(await review.approved(candidate), false);
  assert.equal(gateway.requests.length, 2); // Required guards need no selection calls.
});

test("repair limit is terminal across later attempts and charges the shared allowance", async (t) => {
  const gateway = new ScriptedGateway([blocked, blocked]);
  const f = await fixture(t, gateway);
  const review = f.review(
    configuration({ "input-validation-guard": { guardMode: "required" } }, { maxFixCycles: 1 }),
  );
  assert.equal((await review.apply(await f.edit("one"))).accepted, false);
  await assert.rejects(review.apply(await f.edit("two")), /repair limit/);
  await assert.rejects(review.apply(await f.edit("three")), /repair limit/);
  assert.equal(gateway.requests.length, 2);
});

test("unknown or malformed required reviews never pass", async (t) => {
  for (const result of [
    { verdict: "unknown", findings: [] },
    { verdict: "pass" },
    { verdict: "fail", findings: [{ path: "invented.ts", reason: "Unverified" }] },
  ]) {
    const f = await fixture(t, new ScriptedGateway([result]));
    const review = f.review(configuration({ "input-validation-guard": { guardMode: "required" } }));
    await assert.rejects(review.apply(await f.edit("after")), /incomplete/);
  }
});

test("advisory findings are recorded without blocking acceptance", async (t) => {
  const f = await fixture(t, new ScriptedGateway([blocked]));
  const review = f.review(
    configuration({ "readability-guard": { guardMode: "required", advisory: true } }),
  );
  assert.equal((await review.apply(await f.edit("after"))).accepted, true);
  const enforced = f.writes.find((write) => write.name === "coding-guard-enforcement")!.value as {
    decision: { warningRuleIds: string[] };
  };
  assert.deepEqual(enforced.decision.warningRuleIds, ["readability-guard.review"]);
});

test("disabled guard selection produces no model calls", async (t) => {
  const gateway = new ScriptedGateway([]);
  const f = await fixture(t, gateway);
  assert.equal((await f.review(configuration()).apply(await f.edit("after"))).accepted, true);
  assert.equal(gateway.requests.length, 0);
});

test("optional guards are selected again after a repair without removing required coverage", async (t) => {
  const gateway = new ScriptedGateway([exclude, blocked, include, passed, passed]);
  const f = await fixture(t, gateway);
  const review = f.review(
    configuration({
      "input-validation-guard": { guardMode: "required" },
      "error-guard": { guardMode: "auto" },
    }),
  );
  assert.equal((await review.apply(await f.edit("first"))).accepted, false);
  assert.equal((await review.apply(await f.edit("fixed"))).accepted, true);
  assert.equal(f.writes.filter((write) => write.name === "coding-guard-selection").length, 2);
  assert.equal(f.writes.filter((write) => write.name === "coding-guard-review").length, 3);
  assert.equal(gateway.requests.length, 5);
});
