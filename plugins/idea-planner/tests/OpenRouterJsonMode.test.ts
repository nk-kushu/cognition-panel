import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { OpenRouterModels, supportsJsonMode, withJsonMode } from "../src/OpenRouterModel";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OPENROUTER_JSON_MODE;
});

const CATALOG = {
  data: [
    { id: "vendor/with-json", context_length: 100000, top_provider: { max_completion_tokens: 8000 }, supported_parameters: ["max_tokens", "response_format", "tools"] },
    { id: "vendor/without-json", context_length: 100000, top_provider: { max_completion_tokens: 8000 }, supported_parameters: ["max_tokens", "tools"] },
    { id: "vendor/unlisted", context_length: 100000, top_provider: { max_completion_tokens: 8000 } },
  ],
};

/** Loads the catalog, binds the model, makes one call and returns the body sent to /responses. */
async function sentBody(modelId: string): Promise<Record<string, any>> {
  let sent: Record<string, any> | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify(CATALOG), { status: 200 });
    if (String(url).endsWith("/key")) return new Response("{}", { status: 200 });
    if (String(url).endsWith("/responses")) {
      sent = JSON.parse(String(init?.body));
      return new Response("{}", { status: 500 });
    }
    throw new Error(`unexpected request ${String(url)}`);
  }) as typeof fetch;
  const models = await OpenRouterModels.load("key", new AbortController().signal);
  const binding = models.bind("main", modelId, "TEST_MODEL");
  const originalError = console.error;
  console.error = () => {};
  try {
    await binding.gateway.generate(
      { instructions: "Answer with JSON.", messages: [{ role: "user", text: "{}" }], maxOutputTokens: 100, inputTokenUpperBound: 100, promptCacheKey: null },
      { operationId: "op", signal: new AbortController().signal, deadlineEpochMs: null, timeoutMs: 5000 },
    );
  } finally {
    console.error = originalError;
  }
  assert.ok(sent, "no request reached /responses");
  return sent;
}

test("a model whose catalog lists response_format is asked for one JSON object, with the privacy routing kept", async () => {
  const body = await sentBody("vendor/with-json");
  assert.deepEqual(body.text, { format: { type: "json_object" } });
  assert.deepEqual(body.provider, { zdr: true, data_collection: "deny" });
  assert.equal(body.model, "vendor/with-json");
});

test("a model that does not list it, or has no list, is called as before", async () => {
  for (const id of ["vendor/without-json", "vendor/unlisted"]) assert.equal("text" in (await sentBody(id)), false, id);
});

test("OPENROUTER_JSON_MODE=off switches it off", async () => {
  process.env.OPENROUTER_JSON_MODE = "off";
  assert.equal("text" in (await sentBody("vendor/with-json")), false);
});

test("the helpers: support is read from the catalog, and a format already chosen is never overwritten", () => {
  assert.equal(supportsJsonMode({ supported_parameters: ["response_format"] }), true);
  assert.equal(supportsJsonMode({ supported_parameters: ["tools"] }), false);
  assert.equal(supportsJsonMode(undefined), false);
  const body = { model: "m", text: { verbosity: "low" } };
  assert.deepEqual(withJsonMode(body, true).text, { verbosity: "low", format: { type: "json_object" } });
  assert.equal(withJsonMode(body, false), body);
  const chosen = { text: { format: { type: "json_schema" } } };
  assert.equal(withJsonMode(chosen, true), chosen);
});
