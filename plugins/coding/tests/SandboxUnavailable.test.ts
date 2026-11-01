import assert from "node:assert/strict";
import test from "node:test";
import { SandboxedCli } from "../src/infrastructure/sandbox/SandboxedCli";

test("refuses to run when isolation is unavailable, without an unconfined fallback", async () => {
  const context = {
    identity: { runId: "run", operationId: "op" },
    scope: { scopeId: "s", projectId: "p" },
    signal: new AbortController().signal,
    deadlineEpochMs: null,
    reporter: { progress: async () => undefined },
  };
  const result = await new SandboxedCli()
    .run({ command: ["/bin/sh", "-c", "echo escaped"], mounts: [], workingDirectory: "/" }, context)
    .catch((error: Error) => error);
  if (result instanceof Error) return;
  assert.notEqual(result.exitCode, 0, "Blocked namespace creation must not run the command.");
  assert.doesNotMatch(result.output, /escaped/);
});
