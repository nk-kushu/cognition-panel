import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Thread ids the panel issues are UUIDs; anything else is not used as a file name. */
const SAFE_THREAD_ID = /^[A-Za-z0-9-]{1,100}$/;

/**
 * Which agent answered last in each chat thread. The panel records only the router's name per turn,
 * and each message runs in a new process, so this lives in a small file per thread. Losing it (a
 * restart) only means the next free-text message has no previous agent.
 */
export class ThreadMemory {
  constructor(private readonly directory: string = path.join(tmpdir(), "kushex-cognition-router")) {}

  previousAgent(threadId: string | undefined): string | null {
    const file = this.file(threadId);
    if (!file) return null;
    try {
      const value = JSON.parse(readFileSync(file, "utf8")) as { agentId?: unknown };
      return typeof value.agentId === "string" ? value.agentId : null;
    } catch {
      return null;
    }
  }

  remember(threadId: string | undefined, agentId: string): void {
    const file = this.file(threadId);
    if (!file) return;
    try {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(file, JSON.stringify({ agentId, at: new Date().toISOString() }));
    } catch {
      // Routing still works without memory; the next message just has no previous agent.
    }
  }

  private file(threadId: string | undefined): string | null {
    return threadId && SAFE_THREAD_ID.test(threadId) ? path.join(this.directory, `${threadId}.json`) : null;
  }
}
