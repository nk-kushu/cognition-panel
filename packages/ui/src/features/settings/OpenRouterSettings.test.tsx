import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { KushexPanel } from "../../KushexPanel";

afterEach(() => vi.unstubAllGlobals());

it("sets up, tests and removes OpenRouter from the global Settings page", async () => {
  const fallback = globalThis.fetch;
  const calls: { method: string; path: string; body: unknown }[] = [];
  let configured = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(new URL(String(input), location.href), init);
      const path = new URL(request.url).pathname;
      if (!path.includes("/integrations/openrouter")) return fallback(input, init);
      const body = request.method === "GET" ? null : await request.json();
      calls.push({ method: request.method, path, body });
      if (path.endsWith("/models"))
        return Response.json([
          { id: "vendor/code", name: "Code", contextTokens: 32000, maxOutputTokens: 4096 },
        ]);
      if (request.method === "PUT") configured = true;
      if (request.method === "DELETE") configured = false;
      return Response.json({ configured, updatedAt: null });
    }),
  );
  const user = userEvent.setup();
  render(<KushexPanel initialPath="/settings" apiBaseUrl="/custom-api" />);
  await user.click(screen.getByRole("menuitem", { name: "OpenRouter" }));
  await screen.findByText("No API key saved.");
  const key = screen.getByLabelText("OpenRouter API key");
  await user.type(key, "sk-or-secret");
  await user.click(screen.getByRole("button", { name: "Save API key" }));
  await screen.findByText("API key saved (encrypted).");
  expect(key).toHaveValue("");
  expect(calls.find((call) => call.method === "PUT")).toEqual({
    method: "PUT",
    path: "/custom-api/integrations/openrouter",
    body: { apiKey: "sk-or-secret" },
  });
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  await screen.findByText("Connected to OpenRouter. 1 text models available.");
  await user.click(screen.getByRole("button", { name: "Remove API key" }));
  await screen.findByText("No API key saved.");
  await screen.findByText("API key removed.");
});
