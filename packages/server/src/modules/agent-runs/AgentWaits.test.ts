import { pino } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../errors/ConflictError.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { RequestContext } from "../../shared/application/RequestContext.js";
import type { ProjectService } from "../projects/public.js";
import { AgentWaits } from "./application/AgentWaits.js";
import type { AgentRunService } from "./application/AgentRunService.js";

const context = { actor: { id: "actor" } } as RequestContext;
const row = (kind: string, payload: object) => ({
  id: "run",
  projectId: "project",
  actorId: "actor",
  workspaceId: "original-workspace",
  agentName: "coding",
  threadId: "thread",
  agentRunRef: "agent-run",
  waitRef: "wait-1",
  kind,
  payload,
  status: "pending",
  response: null,
});
const decision = {
  question: "Which package?",
  choices: [{ label: "Package A", packages: ["a"] }],
};

describe("answering a waiting run", () => {
  let current: ReturnType<typeof row>;
  let launch: ReturnType<typeof vi.fn>;
  let remember: ReturnType<typeof vi.fn<(...input: unknown[]) => Promise<unknown>>>;
  let waits: AgentWaits;

  const setUp = (wait: ReturnType<typeof row>) => {
    current = wait;
    launch = vi.fn(async () => ({ id: "next" }));
    remember = vi.fn<(...input: unknown[]) => Promise<unknown>>(async () => undefined);
    const db = {
      agentRunWait: {
        findFirst: vi.fn(async () => current),
        updateMany: vi.fn(async ({ data }: { data: { status: string } }) => {
          if (current.status !== "pending") return { count: 0 };
          current = { ...current, status: data.status };
          return { count: 1 };
        }),
      },
    } as unknown as PrismaClient;
    waits = new AgentWaits(
      db,
      { find: async () => undefined } as unknown as ProjectService,
      { add: remember },
      pino({ level: "silent" }),
    );
    waits.attach({ launch } as unknown as AgentRunService);
  };

  beforeEach(() => setUp(row("decision", decision)));

  it("takes authorized packages from what was asked, and resumes the same run", async () => {
    await waits.answer({ ...context, workspaceId: "different-workspace" }, "project", "run", {
      choice: "Package A",
      text: "",
    });
    expect(launch.mock.calls[0]![0]).toMatchObject({ workspaceId: "original-workspace" });
    const [, , request, resume] = launch.mock.calls[0]!;
    expect(request).toMatchObject({ agentName: "coding", threadId: "thread", debug: false });
    expect(resume).toEqual({
      runId: "agent-run",
      answer: { waitId: "wait-1", choice: "Package A", text: "", digest: "", packages: ["a"] },
    });
  });

  it("rejects a choice that was not offered", async () => {
    await expect(
      waits.answer(context, "project", "run", { choice: "Package Z", text: "" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(launch).not.toHaveBeenCalled();
  });

  it("remembers only when asked to", async () => {
    await waits.answer(context, "project", "run", {
      choice: "Package A",
      text: "",
      remember: "Prefer Package A.",
    });
    expect(remember).toHaveBeenCalledWith(context, "project", "Prefer Package A.");
  });

  it("resumes a run once, however many answers arrive", async () => {
    await waits.answer(context, "project", "run", { choice: "Package A", text: "" });
    await expect(
      waits.answer(context, "project", "run", { choice: "Package A", text: "" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("binds approval to the reviewed digest and requires a reason for changes", async () => {
    setUp(row("skeleton-review", { digest: "revision:a" }));
    await expect(
      waits.answer(context, "project", "run", {
        choice: "approve",
        text: "",
        digest: "revision:b",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      waits.answer(context, "project", "run", { choice: "request-changes", text: " " }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await waits.answer(context, "project", "run", {
      choice: "approve",
      text: "",
      digest: "revision:a",
    });
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("does not resume a cancelled run", async () => {
    await waits.cancel(context, "project", "run");
    await expect(
      waits.answer(context, "project", "run", { choice: "Package A", text: "" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(launch).not.toHaveBeenCalled();
  });
});
