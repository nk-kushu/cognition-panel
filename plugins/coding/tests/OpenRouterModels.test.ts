import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CodingModelFactory,
  OpenRouterTransport,
} from "../src/integrations/kushex/OpenRouterModels";
import { defaultCodingSettings } from "../src/engineering/types";
import type { IModelBindings } from "../src/CodingAgentOptions";

const fallback: IModelBindings = {
  bind: () => {
    throw new Error("codex fallback");
  },
};

test("OpenRouter bindings inherit the default, preserve explicit Codex roles and use catalog limits", async () => {
  const settings = {
    ...defaultCodingSettings,
    models: {
      ...defaultCodingSettings.models,
      default: "openrouter:vendor/code",
      answer: "codex-model",
    },
  };
  const bindings = await new CodingModelFactory("sk-or-test", async () =>
    Response.json({
      data: [
        { id: "vendor/code", context_length: 32000, top_provider: { max_completion_tokens: 2000 } },
      ],
    }),
  ).create(settings, fallback);
  assert.equal(bindings.bind("implementation").profile.providerId, "openrouter");
  assert.equal(bindings.bind("implementation").profile.maxOutputTokens, 2000);
  assert.throws(() => bindings.bind("answer"), /codex fallback/);
  await assert.rejects(
    () => new CodingModelFactory(undefined, fetch).create(settings, fallback),
    /Save an OpenRouter API key/,
  );
  const unused = await new CodingModelFactory(undefined, async () => {
    throw new Error("must not fetch");
  }).create(defaultCodingSettings, fallback);
  assert.equal(unused, fallback);
});

test("OpenRouter transport uses its endpoint, authenticates, normalizes aliases and keeps bounded responses", async () => {
  const transport = new OpenRouterTransport("sk-or-test", async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/responses");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer sk-or-test");
    return Response.json({ model: "canonical-model", status: "completed" });
  });
  const body = {
    model: "vendor/alias",
    instructions: "",
    input: [],
    max_output_tokens: 100,
    store: false as const,
    stream: false as const,
    truncation: "disabled" as const,
  };
  assert.deepEqual(await transport.create(body, new AbortController().signal, 1000), {
    model: "vendor/alias",
    status: "completed",
  });
  await assert.rejects(() => transport.create(body, new AbortController().signal, 1), /byte limit/);
});

test("a selected OpenRouter model completes a Kushibot call and reports usage", async () => {
  const settings = {
    ...defaultCodingSettings,
    models: { ...defaultCodingSettings.models, default: "openrouter:vendor/alias" },
  };
  const http: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/models"))
      return Response.json({ data: [{ id: "vendor/alias", context_length: 32000 }] });
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "vendor/alias");
    assert.equal(request.store, false);
    assert.equal(request.stream, false);
    return Response.json({
      id: "gen_test",
      model: "vendor/canonical",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello from OpenRouter" }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  };
  const bindings = await new CodingModelFactory("sk-or-test", http).create(settings, fallback);
  const reply = await bindings.bind("answer").gateway.generate(
    {
      instructions: "Answer the question.",
      messages: [{ role: "user", text: "Hello" }],
      maxOutputTokens: 100,
      inputTokenUpperBound: 100,
      promptCacheKey: null,
    },
    {
      operationId: "openrouter-test",
      signal: new AbortController().signal,
      timeoutMs: 1000,
      deadlineEpochMs: null,
    },
  );
  assert.equal(reply.status, "completed");
  assert.equal(reply.text, "Hello from OpenRouter");
  assert.equal(reply.providerId, "openrouter");
  assert.equal(reply.usage?.inputTokens, 10);
  assert.equal(reply.usage?.outputTokens, 5);
});
