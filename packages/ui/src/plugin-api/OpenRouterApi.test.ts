import { expect, it, vi } from "vitest";
import { OpenRouterApi } from "./OpenRouterApi";

it("searches model IDs and names through the configured Cognition Panel API", async () => {
  const http = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json([
      { id: "vendor/code", name: "Code model", contextTokens: 32000 },
      { id: "other/chat", name: "Chat model", contextTokens: 16000 },
    ]),
  );
  const api = new OpenRouterApi("/custom-api/", http);
  expect(await api.models(" VENDOR ")).toEqual([
    { id: "vendor/code", name: "Code model", contextTokens: 32000 },
  ]);
  expect(http).toHaveBeenCalledWith("/custom-api/integrations/openrouter/models", {
    signal: undefined,
  });
  http.mockResolvedValue(
    Response.json([{ id: "other/chat", name: "Chat model", contextTokens: 16000 }]),
  );
  expect(await api.models("CHAT MODEL")).toHaveLength(1);
  http.mockResolvedValue(Response.json([], { status: 200 }));
  expect(await api.models("missing")).toEqual([]);
});

it("surfaces server errors to plugin callers", async () => {
  const http = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ message: "Save an OpenRouter API key first." }, { status: 409 }),
    );
  await expect(new OpenRouterApi("/api", http).models()).rejects.toThrow(
    "Save an OpenRouter API key first.",
  );
});
