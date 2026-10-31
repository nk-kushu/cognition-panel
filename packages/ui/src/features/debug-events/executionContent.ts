import type { RecordedDebugEventDto } from "@kushex/contracts";

export type ExecutionDetail = { stage: string; text: string; complete: boolean };

/** Never present partial transport chunks as a complete prompt or result. */
export function executionDetails(events: readonly RecordedDebugEventDto[]): ExecutionDetail[] {
  const groups = new Map<string, { stage: string; parts: number; chunks: Map<number, string> }>();
  for (const { event } of events) {
    const p = event.payload;
    if (!p.operation?.startsWith("detail.") || p.content === undefined) continue;
    const key = `${event.trace.spanId}:${p.operation}`;
    let group = groups.get(key);
    if (!group) {
      group = { stage: p.operation.slice(7), parts: p.metrics?.parts ?? 1, chunks: new Map() };
      groups.set(key, group);
    }
    group.chunks.set(p.count ?? 0, p.content);
  }
  return [...groups.values()].map((g) => {
    const complete =
      g.chunks.size === g.parts &&
      Array.from({ length: g.parts }, (_, i) => g.chunks.has(i)).every(Boolean);
    const raw = [...g.chunks]
      .sort(([a], [b]) => a - b)
      .map(([, s]) => s)
      .join("");
    let text = raw;
    if (complete) {
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* Show raw data. */
      }
    }
    return { stage: g.stage, text, complete };
  });
}
