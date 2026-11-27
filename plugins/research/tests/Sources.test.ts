import assert from "node:assert/strict";
import { test } from "node:test";
import { CapabilityRegistry } from "../src/capabilities/CapabilityRegistry";
import { EVIDENCE_TYPES, sectionOf } from "../src/sections";
import { SOURCE_GUIDE, sourceGuideText } from "../src/sources";

test("every site files into real research sections and a real evidence type", () => {
  for (const source of SOURCE_GUIDE) {
    assert.ok(source.sections.length > 0, `${source.id} files nowhere`);
    for (const key of source.sections) assert.ok(sectionOf(key), `${source.id}: unknown section ${key}`);
    assert.ok((EVIDENCE_TYPES as readonly string[]).includes(source.evidence), `${source.id}: unknown evidence type ${source.evidence}`);
    assert.ok(source.searchFor.length >= 2 && source.lookFor.length >= 2, `${source.id}: too thin to follow`);
    assert.ok(source.capture.length > 20, `${source.id}: no capture instruction`);
  }
  assert.equal(new Set(SOURCE_GUIDE.map((source) => source.id)).size, SOURCE_GUIDE.length);
});

test("the guide covers every site the Cognition Capture extension reads", () => {
  const ids = SOURCE_GUIDE.map((source) => source.id);
  for (const wanted of ["reddit", "hackernews", "g2", "google-play", "app-store", "meta-ads", "search", "keyword-planner", "google-trends", "ads-transparency", "pricing-pages", "official-sources"])
    assert.ok(ids.includes(wanted), `missing ${wanted}`);
});

test("legal sources are official sources and file into the legal sections only", () => {
  const legal = SOURCE_GUIDE.find((source) => source.id === "official-sources")!;
  assert.equal(legal.evidence, "official_source");
  assert.ok(legal.sections.every((key) => key.startsWith("legal.")));
  assert.match(legal.capture, /Not legal advice/);
});

test("people's own words are real_user_quote and nothing else claims that weight", () => {
  const people = SOURCE_GUIDE.filter((source) => source.evidence === "real_user_quote").map((source) => source.id);
  assert.deepEqual(people, ["reddit", "hackernews", "g2", "google-play", "app-store"]);
});

test("the registry offers /sources, read-only, with the whole guide and the no-invention rule", () => {
  const sources = CapabilityRegistry.default().command("/sources")!;
  assert.equal(sources.id, "sources");
  const instructions = sources.instructions();
  for (const source of SOURCE_GUIDE) assert.ok(instructions.includes(`- ${source.id} (${source.name})`), `${source.id} is not in the instructions`);
  assert.equal(instructions.includes(sourceGuideText()), true);
  assert.match(instructions, /Never invent a competitor, a price, a number or a quote/);
  assert.match(instructions, /If the idea is not clear, finish at once/);
  assert.match(instructions, /if it is empty, say so and ask for it instead of guessing the law/);
  assert.doesNotMatch(instructions, /propose_finding|save_business_plan|save_source/);
});

test("/sources fetches and files nothing: its tools are the three read-only research tools", () => {
  const sources = CapabilityRegistry.default().command("/sources")!;
  const seen: string[][] = [];
  sources.tools({ research: (ids: readonly string[]) => (seen.push([...ids]), { ids, call: async () => ({}) }) } as never);
  assert.deepEqual(seen, [["research_overview", "read_idea", "list_documents"]]);
});
