import type { Agent, ChatResponse, EditingResult, TaskInput } from "kushibot";
import { LocalChatArtifacts } from "./LocalChatArtifacts";
import type { ChatRequest } from "./ChatRequest";
import { CodingEngineeringConfiguration } from "../../engineering/CodingEngineeringConfiguration";
import { createCodingAgent } from "../../composition/createCodingAgent";

/**
 * Chat turns one chat message into a coding task,
 * runs the agent, and returns its execution result.
 */
export async function chat(
  request: ChatRequest,
): Promise<
  ChatResponse<EditingResult> & Awaited<ReturnType<Agent<TaskInput, EditingResult>["run"]>>
> {
  const localArtifacts = await LocalChatArtifacts.open(
    request.workspace,
    process.env.KUSHEX_ARTIFACTS_DIR,
  );

  const artifacts = localArtifacts.services.store;

  try {
    const agent = createCodingAgent({
      provider: "codex-cli",
      workspace: request.workspace,
      artifacts,
      engineering: new CodingEngineeringConfiguration(request.configuration?.engineering ?? {}),
      excludedDirectories: process.env.KUSHEX_EXCLUDED_DIRECTORIES?.split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      ...(request.debug ? { debug: request.debug } : {}),
      codex: {
        executable: process.env.CODEX_EXECUTABLE || undefined,
        codexHome: process.env.CODEX_HOME || undefined,
      },
      profile: {
        id: "coding-chat",
        providerId: "codex-cli",
        modelId:
          typeof request.configuration?.model === "string" && request.configuration.model.trim()
            ? request.configuration.model.trim()
            : process.env.CODEX_MODEL || "gpt-6.1-sol",
        contextTokens: 400_000,
        maxOutputTokens: 16_000,
        maxRequestBytes: 1_048_576,
        maxResponseBytes: 1_048_576,
        supportsPromptCacheKey: false,
      },
    });

    const run = await agent.run(
      {
        goal: request.message,
        acceptanceCriteria: ["The change the goal asks for is made in the permitted files."],
        filePaths: [...request.files],
        sourceRefs: [],
      },
      { signal: request.signal, onProgress: (message) => request.progress(message) },
    );

    const result = run.result;
    const outcome = run.snapshot.outcome;
    const incomplete =
      outcome?.status === "failed"
        ? outcome.error.message
        : outcome?.status === "stopped"
          ? outcome.reason.message
          : "The coding task did not produce a completed result.";

    return {
      ...run,
      schemaVersion: 1,
      message: result?.summary ?? incomplete,
      unresolved: result?.unresolved ?? [incomplete],
      result,
      presentation:
        result && result.changedPaths.length > 0 && result.unresolved.length === 0
          ? "changes"
          : "message",
    };
  } finally {
    await localArtifacts.close();
  }
}
