import {
  Agent,
  AgentRuntimeFactory,
  NodeSqliteDatabase,
  SqlAgentStoreFactory,
  sqliteUsageLedgerStatements,
  sqliteWorkflowRunStatements,
} from "kushibot";
import type { CodingAgentOptions } from "../CodingAgentOptions";
import type { RunState } from "../context/RunState";
import { digestOf } from "../context/RunContext";
import { MAX_WAITS } from "../workflow/CodingWorkflow";
import {
  CodingRunWorkflow,
  type CodingResult,
  type CodingTask,
} from "../workflow/CodingRunWorkflow";

export type CodingAgent = Readonly<{
  agent: Agent<CodingTask, CodingResult>;
  task: CodingTask;
  close(): Promise<void>;
}>;

/**
 * Composes one run's agent without starting it. The same composition with the same pinned
 * run reopens a waiting run, because the workflow definition must match what was stored.
 */
export function createCodingAgent(
  runId: string,
  options: CodingAgentOptions,
  state: RunState,
): CodingAgent {
  const { pinned, run, models, artifacts, debug, modelTimeoutMs, maxTurns } = options;
  const { limits } = pinned.settings;
  const database = new NodeSqliteDatabase(run.databasePath);
  const fallback = models.bind("default");
  return {
    task: { digest: digestOf([pinned.message, pinned.files]) },
    close: () => database.close(),
    agent: new Agent({
      id: "coding",
      suspendable: true,
      requestContract: {
        id: "coding-task",
        version: "2",
        validate: async (value) => ({ valid: true, value: value as CodingTask }),
      },
      workflow: new CodingRunWorkflow(options, state, artifacts),
      runtime: new AgentRuntimeFactory({
        gateway: fallback.gateway,
        profile: fallback.profile,
        stores: new SqlAgentStoreFactory({
          database,
          workflow: sqliteWorkflowRunStatements,
          usage: sqliteUsageLedgerStatements,
        }),
        scope: { scopeId: runId, projectId: "coding", workspaceId: runId },
        timeoutMs: limits.runMinutes * 60_000,
        modelTimeoutMs: modelTimeoutMs ?? 180_000,
        maxTurns: maxTurns ?? 30,
        limits: {
          modelCalls: limits.modelCalls,
          inputTokens: limits.inputTokens,
          outputTokens: Math.ceil(limits.inputTokens / 8),
          iterations: limits.modelCalls,
          toolCalls: limits.modelCalls * 2,
          // Each return and each answered wait is one engine correction.
          fixes: limits.totalReturns + MAX_WAITS,
        },
        ...(debug ? { debug } : {}),
      }),
    }),
  };
}
