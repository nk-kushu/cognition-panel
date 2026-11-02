import { Tag, Tooltip } from "antd";
import { IconChevronRight } from "@tabler/icons-react";
import type { DebugEventDto, RecordedDebugEventDto } from "./types";
import { useState } from "react";
import { AppIcon } from "./internal/AppIcon";
import { borderAll } from "./internal/styles";
import { formatDuration, formatOffset, spanPhase, type DebugLevel } from "./debugEventView";
import { describeEvent } from "./debugTrace";
import { TONE_DOTS } from "./traceStyles";

const LEVEL_STYLES: Record<DebugLevel, string> = {
  trace: "kxd:bg-fill kxd:text-text-muted",
  debug: "kxd:bg-fill kxd:text-text-muted",
  info: "kxd:bg-primary/12 kxd:text-primary",
  warn: "kxd:bg-warning/15 kxd:text-warning",
  error: "kxd:bg-error/12 kxd:text-error",
};

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

/** Every event in the order kushibot recorded it, each as a sentence with its raw fields on demand. */
export function EventList({
  events,
  first,
}: Readonly<{ events: readonly RecordedDebugEventDto[]; first: number }>) {
  return (
    <ol
      aria-label="Debug events"
      className="kxd:m-0 kxd:flex kxd:list-none kxd:flex-col kxd:gap-0.5 kxd:p-0"
    >
      {events.map((item) => (
        <EventRow
          key={`${item.streamId}:${item.sequence}`}
          item={item}
          offset={item.event.occurredAtEpochMs - first}
        />
      ))}
    </ol>
  );
}

function EventRow({ item, offset }: Readonly<{ item: RecordedDebugEventDto; offset: number }>) {
  const [open, setOpen] = useState(false);
  const { event } = item;
  const { payload } = event;
  const phase = spanPhase(event);
  const line = describeEvent(event);
  return (
    <li
      className={`kxd:rounded-lg ${open ? `kxd:bg-surface-muted ${borderAll}` : "kxd:border kxd:border-solid kxd:border-transparent"}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="kxd:flex kxd:w-full kxd:cursor-pointer kxd:items-start kxd:gap-3 kxd:rounded-lg kxd:border-0 kxd:bg-transparent kxd:px-2 kxd:py-1.5 kxd:text-left kxd:text-text kxd:hover:bg-fill"
      >
        <span
          className={`kxd:mt-0.5 kxd:inline-flex kxd:shrink-0 kxd:text-text-muted kxd:transition-transform ${open ? "kxd:rotate-90" : ""}`}
        >
          <AppIcon icon={IconChevronRight} size="sm" />
        </span>
        <Tooltip title={clock.format(event.occurredAtEpochMs)}>
          <span className="kxd:w-20 kxd:shrink-0 kxd:pt-px kxd:font-mono kxd:text-xs kxd:text-text-muted kxd:tabular-nums">
            {formatOffset(offset)}
          </span>
        </Tooltip>
        <span
          className={`kxd:w-12 kxd:shrink-0 kxd:rounded kxd:px-1 kxd:text-center kxd:font-mono kxd:text-[10px] kxd:leading-5 kxd:uppercase ${LEVEL_STYLES[event.level]}`}
        >
          {event.level}
        </span>
        <span
          className={`kxd:mt-1.5 kxd:size-2 kxd:shrink-0 kxd:rounded-full ${phase ? "kxd:bg-border" : TONE_DOTS[line.tone]}`}
        />
        <span className="kxd:flex kxd:min-w-0 kxd:flex-1 kxd:flex-col kxd:gap-0.5">
          <span className="kxd:flex kxd:flex-wrap kxd:items-center kxd:gap-x-2 kxd:gap-y-1">
            <span
              className={`kxd:text-[13px] ${phase ? "kxd:text-text-muted" : "kxd:font-medium"}`}
            >
              {line.text}
            </span>
            {payload.durationMs !== undefined && (
              <Tag bordered={false} className="kxd:m-0 kxd:font-mono kxd:text-[11px]">
                {formatDuration(payload.durationMs)}
              </Tag>
            )}
            <span className="kxd:font-mono kxd:text-[11px] kxd:text-text-muted">
              {payload.operation ? `${payload.operation} · ` : ""}
              {event.type}
            </span>
          </span>
          {line.detail && (
            <span className="kxd:text-xs kxd:break-words kxd:whitespace-pre-wrap kxd:text-text-muted">
              {line.detail}
            </span>
          )}
        </span>
      </button>
      {open && <EventDetails item={item} event={event} />}
    </li>
  );
}

function EventDetails({
  item,
  event,
}: Readonly<{ item: RecordedDebugEventDto; event: DebugEventDto }>) {
  const facts: readonly (readonly [string, string | number | null | undefined])[] = [
    ["Sequence", item.sequence],
    ["Occurred", new Date(event.occurredAtEpochMs).toISOString()],
    ["Span", event.trace.spanId],
    ["Parent span", event.trace.parentSpanId],
    ["Caused by", event.trace.causationEventId],
    ["Operation", event.identity.operationId],
    ["Step run", event.identity.stepRunId],
    ["Session", event.identity.sessionId],
    ["Refs", event.payload.relatedRefs?.join("  ·  ")],
  ];
  return (
    <div className="kxd:flex kxd:flex-col kxd:gap-2 kxd:px-3 kxd:pt-1 kxd:pb-3 kxd:pl-9">
      <dl className="kxd:m-0 kxd:grid kxd:grid-cols-[max-content_1fr] kxd:gap-x-4 kxd:gap-y-0.5 kxd:text-xs">
        {facts
          .filter(([, value]) => value !== undefined && value !== null && value !== "")
          .map(([label, value]) => (
            <div key={label} className="kxd:contents">
              <dt className="kxd:text-text-muted">{label}</dt>
              <dd className="kxd:m-0 kxd:font-mono kxd:break-all">{value}</dd>
            </div>
          ))}
      </dl>
      <pre className="kxd:m-0 kxd:max-h-72 kxd:overflow-auto kxd:rounded-md kxd:bg-fill kxd:p-2 kxd:font-mono kxd:text-xs">
        {JSON.stringify(event, null, 2)}
      </pre>
    </div>
  );
}
