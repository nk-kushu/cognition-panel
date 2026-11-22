import { randomUUID } from "node:crypto";
import type { IScopedDebugRecorderFactory } from "kushibot";

/** The parts of the runner's chat request this agent uses (see plugins/README.md). */
type ChatRequest = Readonly<{
  message: string;
  threadId?: string;
  workspace: string;
  signal: AbortSignal;
  progress(message: string): void;
  debug?: IScopedDebugRecorderFactory;
}>;

/** Replies to the user's text without calling a model. Set a breakpoint here to debug a run. */
export async function chat(request: ChatRequest): Promise<string> {
  const reply = `You said: ${request.message.trim()}`;
  const recorder = request.debug?.create({
    scope: { scopeId: "echo", projectId: request.workspace },
    identity: { operationId: randomUUID(), ...(request.threadId ? { runId: request.threadId } : {}) },
  });

  if (!recorder) return reply;
  return recorder.operation("echo.reply", async () => {
    request.progress("Echoing the message");
    recorder.event("progress.reported", "info", { message: request.message, reply });
    return reply;
  }, { message: request.message });
}
