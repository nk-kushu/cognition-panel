import { ExecutionDetails } from "./ExecutionDetails";
import { Empty, Tag, Tooltip } from "antd";
import { IconChevronRight } from "@tabler/icons-react";
import type { RecordedDebugEventDto } from "./types";
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from "react";
import { AppIcon } from "./internal/AppIcon";
import { borderB, borderL } from "./internal/styles";
import {
  KIND_INFO,
  describeEvent,
  findSpan,
  visibleSpans,
  type Badge,
  type TraceNode,
} from "./debugTrace";
import { formatDuration, formatOffset } from "./debugEventView";
import { KIND_STYLES, TONE_DOTS, TONE_TAGS } from "./traceStyles";

type TraceViewProps = Readonly<{
  root: TraceNode;
  collapsed: ReadonlySet<string>;
  /** Spans kept by the search, or null for all. */
  keep: ReadonlySet<string> | null;
  selectedId: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}>;

/** kushibot's span tree as an indented, collapsible waterfall beside an inspector. */
export function TraceView({
  root,
  collapsed,
  keep,
  selectedId,
  onToggle,
  onSelect,
}: TraceViewProps) {
  const rows = useMemo(
    () => visibleSpans(root, keep ? new Set() : collapsed, keep ?? undefined),
    [root, collapsed, keep],
  );
  const selected = findSpan(root, selectedId) ?? root;
  const total = Math.max(1, root.durationMs ?? 1);

  return (
    <div className="kxd:grid kxd:h-full kxd:min-h-0 kxd:grid-cols-1 kxd:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] kxd:lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] kxd:lg:grid-rows-1">
      <div className="kxd:min-h-0 kxd:overflow-auto">
        <div
          className={`kxd:sticky kxd:top-0 kxd:z-10 kxd:flex kxd:items-center kxd:gap-3 kxd:bg-surface kxd:px-4 kxd:py-1.5 kxd:text-[11px] kxd:font-medium kxd:tracking-wide kxd:text-text-muted kxd:uppercase ${borderB}`}
        >
          <span className="kxd:flex-1">What ran</span>
          <span className="kxd:w-16 kxd:text-right">Took</span>
          <span className="kxd:hidden kxd:w-28 kxd:md:block">When</span>
        </div>
        {rows.length === 0 ? (
          <Empty
            className="kxd:mt-12"
            description={
              keep ? "No step, call or event matches the filter." : "No operations recorded yet."
            }
          />
        ) : (
          <ol aria-label="Trace" className="kxd:m-0 kxd:list-none kxd:p-0 kxd:py-1">
            {rows.map((span) => (
              <SpanRow
                key={span.id}
                span={span}
                runStart={root.startMs}
                total={total}
                open={keep !== null || !collapsed.has(span.id)}
                selected={span.id === selected.id}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))}
          </ol>
        )}
        {root.events.length > 0 && !keep && (
          <div className="kxd:px-4 kxd:pt-2 kxd:pb-4">
            <button
              type="button"
              onClick={() => onSelect("root")}
              className="kxd:cursor-pointer kxd:border-0 kxd:bg-transparent kxd:p-0 kxd:text-xs kxd:text-text-muted kxd:hover:text-primary"
            >
              {root.events.length} run-level {root.events.length === 1 ? "event" : "events"} outside
              any operation →
            </button>
          </div>
        )}
      </div>
      <aside
        aria-label="Span details"
        className={`kxd:min-h-0 kxd:overflow-auto kxd:bg-surface-muted ${borderL} kxd:max-lg:border-t kxd:max-lg:border-l-0 kxd:max-lg:border-solid kxd:max-lg:border-border`}
      >
        <Inspector span={selected} runStart={root.startMs} onSelect={onSelect} />
      </aside>
    </div>
  );
}

function SpanRow({
  span,
  runStart,
  total,
  open,
  selected,
  onToggle,
  onSelect,
}: Readonly<{
  span: TraceNode;
  runStart: number;
  total: number;
  open: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}>) {
  const style = KIND_STYLES[span.kind];
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const left = ((span.startMs - runStart) / total) * 100;
  const width = (((span.endMs ?? runStart + total) - span.startMs) / total) * 100;
  const hasChildren = span.children.length > 0;
  return (
    <li ref={row}>
      <div
        className={`kxd:group kxd:flex kxd:items-center kxd:gap-3 kxd:px-4 kxd:py-1 ${selected ? "kxd:bg-primary/10" : "kxd:hover:bg-fill"}`}
      >
        <div
          className="kxd:flex kxd:min-w-0 kxd:flex-1 kxd:items-center kxd:gap-1.5"
          style={{ paddingLeft: (span.depth - 1) * 18 }}
        >
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={hasChildren ? open : undefined}
            disabled={!hasChildren}
            onClick={() => onToggle(span.id)}
            className={`kxd:inline-flex kxd:size-5 kxd:shrink-0 kxd:items-center kxd:justify-center kxd:rounded kxd:border-0 kxd:bg-transparent kxd:p-0 kxd:text-text-muted ${hasChildren ? "kxd:cursor-pointer kxd:hover:bg-fill" : "kxd:opacity-0"}`}
          >
            <span
              className={`kxd:inline-flex kxd:transition-transform ${open ? "kxd:rotate-90" : ""}`}
            >
              <AppIcon icon={IconChevronRight} size="sm" />
            </span>
          </button>
          <button
            type="button"
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect(span.id)}
            className="kxd:flex kxd:min-w-0 kxd:flex-1 kxd:cursor-pointer kxd:items-center kxd:gap-2 kxd:border-0 kxd:bg-transparent kxd:p-0 kxd:text-left kxd:text-text"
          >
            <span
              className={`kxd:inline-flex kxd:size-6 kxd:shrink-0 kxd:items-center kxd:justify-center kxd:rounded-md ${style.chip} ${style.text}`}
            >
              <AppIcon icon={style.icon} size="sm" />
            </span>
            <span className="kxd:flex kxd:min-w-0 kxd:flex-1 kxd:items-baseline kxd:gap-2">
              <span
                className={`kxd:shrink-0 kxd:text-[13px] kxd:whitespace-nowrap ${span.kind === "turn" || span.kind === "model" || span.kind === "tool" ? "" : "kxd:font-semibold"}`}
              >
                {span.title}
              </span>
              {span.subtitle && (
                <span className="kxd:truncate kxd:text-xs kxd:text-text-muted">
                  {span.subtitle}
                </span>
              )}
            </span>
            <Badges badges={span.badges} />
            {span.status === "running" && (
              <span className="kxd:inline-flex kxd:items-center kxd:gap-1 kxd:text-[11px] kxd:text-primary">
                <span className="kxd:size-1.5 kxd:animate-pulse kxd:rounded-full kxd:bg-primary" />
                running
              </span>
            )}
          </button>
        </div>
        <span className="kxd:w-16 kxd:shrink-0 kxd:text-right kxd:font-mono kxd:text-xs kxd:text-text-muted kxd:tabular-nums">
          {span.durationMs === null ? "…" : formatDuration(span.durationMs)}
        </span>
        <Tooltip
          title={`${formatOffset(span.startMs - runStart)} → ${span.endMs === null ? "still running" : formatOffset(span.endMs - runStart)}`}
        >
          <span className="kxd:relative kxd:hidden kxd:h-2 kxd:w-28 kxd:shrink-0 kxd:rounded-full kxd:bg-fill kxd:md:block">
            <span
              className={`kxd:absolute kxd:inset-y-0 kxd:rounded-full ${style.bar} ${span.status === "running" ? "kxd:animate-pulse" : ""} ${span.status === "failed" ? "kxd:bg-error" : ""}`}
              style={{
                left: `${Math.min(100, Math.max(0, left))}%`,
                width: `max(3px, ${Math.min(100 - left, Math.max(0, width))}%)`,
              }}
            />
          </span>
        </Tooltip>
      </div>
    </li>
  );
}

function Badges({ badges }: Readonly<{ badges: readonly Badge[] }>) {
  if (badges.length === 0) return null;
  return (
    <span className="kxd:flex kxd:min-w-0 kxd:items-center kxd:gap-1 kxd:overflow-hidden">
      {badges.map((badge) => (
        <Tooltip key={badge.text} title={badge.hint}>
          <Tag bordered={false} color={TONE_TAGS[badge.tone]} className="kxd:m-0 kxd:text-[11px]">
            {badge.text}
          </Tag>
        </Tooltip>
      ))}
    </span>
  );
}

type Entry =
  | Readonly<{ at: number; kind: "event"; item: RecordedDebugEventDto }>
  | Readonly<{ at: number; kind: "child"; span: TraceNode }>;

function Inspector({
  span,
  runStart,
  onSelect,
}: Readonly<{ span: TraceNode; runStart: number; onSelect: (id: string) => void }>) {
  const style = KIND_STYLES[span.kind];
  const info = KIND_INFO[span.kind];
  const entries: Entry[] = [
    ...span.events
      .filter((item) => !item.event.payload.operation?.startsWith("detail."))
      .map((item) => ({
        at: item.event.occurredAtEpochMs,
        kind: "event" as const,
        item,
      })),
    ...span.children.map((child) => ({ at: child.startMs, kind: "child" as const, span: child })),
  ].sort((a, b) => a.at - b.at);
  const facts: readonly (readonly [string, string | undefined | null])[] = [
    ["Started", formatOffset(span.startMs - runStart)],
    [
      "Took",
      span.durationMs === null
        ? span.kind === "root"
          ? null
          : "still running"
        : formatDuration(span.durationMs),
    ],
    ["Step run", span.identity.stepRunId],
    ["Session", span.identity.sessionId],
    ["Operation", span.identity.operationId],
    ["Span", span.kind === "root" ? null : span.id],
  ];
  const refs = [...span.refs.entries()].filter(([key]) => key !== "operation");
  const raw = [span.start, ...span.events, span.end].filter(
    (item): item is RecordedDebugEventDto => item !== null,
  );

  return (
    <div className="kxd:flex kxd:flex-col kxd:gap-4 kxd:p-4">
      <div className="kxd:flex kxd:items-start kxd:gap-3">
        <span
          className={`kxd:inline-flex kxd:size-9 kxd:shrink-0 kxd:items-center kxd:justify-center kxd:rounded-lg ${style.chip} ${style.text}`}
        >
          <AppIcon icon={style.icon} size="lg" />
        </span>
        <div className="kxd:flex kxd:min-w-0 kxd:flex-col kxd:gap-0.5">
          <span
            className={`kxd:text-[11px] kxd:font-medium kxd:tracking-wide kxd:uppercase ${style.text}`}
          >
            {info.label}
          </span>
          <span className="kxd:text-base kxd:font-semibold kxd:break-words">{span.title}</span>
          {span.subtitle && (
            <span className="kxd:text-xs kxd:break-words kxd:text-text-muted">{span.subtitle}</span>
          )}
        </div>
      </div>
      {span.badges.length > 0 && (
        <div className="kxd:flex kxd:flex-wrap kxd:gap-1">
          {span.badges.map((badge) => (
            <Tag
              key={badge.text}
              bordered={false}
              color={TONE_TAGS[badge.tone]}
              className="kxd:m-0"
            >
              {badge.text}
              {badge.hint && badge.hint !== "Tokens" ? ` — ${badge.hint}` : ""}
            </Tag>
          ))}
        </div>
      )}
      <p className="kxd:m-0 kxd:text-xs kxd:leading-relaxed kxd:text-text-muted">{info.about}</p>

      <dl className="kxd:m-0 kxd:grid kxd:grid-cols-[max-content_1fr] kxd:gap-x-4 kxd:gap-y-1 kxd:text-xs">
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt className="kxd:text-text-muted">{label}</dt>
              <dd className="kxd:m-0 kxd:font-mono kxd:break-all">{value}</dd>
            </Fragment>
          ))}
      </dl>

      {refs.length > 0 && (
        <Section title="Details">
          <dl className="kxd:m-0 kxd:grid kxd:grid-cols-[max-content_1fr] kxd:gap-x-4 kxd:gap-y-1 kxd:text-xs">
            {refs.map(([key, values]) => (
              <Fragment key={key}>
                <dt className="kxd:text-text-muted">{key || "flag"}</dt>
                <dd className="kxd:m-0 kxd:flex kxd:flex-wrap kxd:gap-1">
                  {values.map((value) => (
                    <span
                      key={value}
                      className="kxd:rounded kxd:bg-fill kxd:px-1.5 kxd:font-mono kxd:text-[11px] kxd:break-all"
                    >
                      {value}
                    </span>
                  ))}
                </dd>
              </Fragment>
            ))}
          </dl>
        </Section>
      )}

      {(["turn", "model", "tool"] as string[]).includes(span.kind) && (
        <ExecutionDetails events={contentEvents(span)} />
      )}

      <Section title={span.kind === "root" ? "Run-level events" : "What happened inside"}>
        {entries.length === 0 ? (
          <span className="kxd:text-xs kxd:text-text-muted">
            Nothing was recorded inside this span.
          </span>
        ) : (
          <ol className="kxd:m-0 kxd:flex kxd:list-none kxd:flex-col kxd:gap-1.5 kxd:p-0">
            {entries.map((entry) =>
              entry.kind === "child" ? (
                <li key={entry.span.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry.span.id)}
                    className="kxd:flex kxd:w-full kxd:cursor-pointer kxd:items-center kxd:gap-2 kxd:rounded-md kxd:border-0 kxd:bg-surface kxd:px-2 kxd:py-1 kxd:text-left kxd:text-text kxd:hover:bg-fill"
                  >
                    <Offset ms={entry.at - runStart} />
                    <span className={`kxd:inline-flex ${KIND_STYLES[entry.span.kind].text}`}>
                      <AppIcon icon={KIND_STYLES[entry.span.kind].icon} size="sm" />
                    </span>
                    <span className="kxd:min-w-0 kxd:flex-1 kxd:truncate kxd:text-xs">
                      <span className="kxd:font-medium">{entry.span.title}</span>
                      {entry.span.subtitle && (
                        <span className="kxd:text-text-muted"> · {entry.span.subtitle}</span>
                      )}
                    </span>
                    {entry.span.durationMs !== null && (
                      <span className="kxd:font-mono kxd:text-[11px] kxd:text-text-muted">
                        {formatDuration(entry.span.durationMs)}
                      </span>
                    )}
                  </button>
                </li>
              ) : (
                <EventLine
                  key={`${entry.item.streamId}:${entry.item.sequence}`}
                  item={entry.item}
                  offset={entry.at - runStart}
                />
              ),
            )}
          </ol>
        )}
      </Section>

      {raw.length > 0 && (
        <details className="kxd:text-xs">
          <summary className="kxd:cursor-pointer kxd:text-text-muted kxd:select-none">
            Raw events ({raw.length})
          </summary>
          <pre className="kxd:mt-2 kxd:max-h-96 kxd:overflow-auto kxd:rounded-md kxd:bg-fill kxd:p-2 kxd:font-mono kxd:text-[11px]">
            {JSON.stringify(
              raw.map((item) => item.event),
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </div>
  );
}

function EventLine({ item, offset }: Readonly<{ item: RecordedDebugEventDto; offset: number }>) {
  const line = describeEvent(item.event);
  return (
    <li className="kxd:flex kxd:items-start kxd:gap-2 kxd:px-2 kxd:py-0.5">
      <Offset ms={offset} />
      <span
        className={`kxd:mt-1.5 kxd:size-2 kxd:shrink-0 kxd:rounded-full ${TONE_DOTS[line.tone]}`}
      />
      <span className="kxd:flex kxd:min-w-0 kxd:flex-col kxd:gap-0.5">
        <span className="kxd:text-xs kxd:break-words">{line.text}</span>
        {line.detail && (
          <span className="kxd:text-[11px] kxd:break-words kxd:whitespace-pre-wrap kxd:text-text-muted">
            {line.detail}
          </span>
        )}
      </span>
    </li>
  );
}

function Offset({ ms }: Readonly<{ ms: number }>) {
  return (
    <span className="kxd:w-16 kxd:shrink-0 kxd:pt-px kxd:font-mono kxd:text-[11px] kxd:text-text-muted kxd:tabular-nums">
      {formatOffset(ms)}
    </span>
  );
}

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="kxd:flex kxd:flex-col kxd:gap-2">
      <h3 className="kxd:m-0 kxd:text-[11px] kxd:font-medium kxd:tracking-wide kxd:text-text-muted kxd:uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function contentEvents(span: TraceNode): RecordedDebugEventDto[] {
  return [...span.events, ...span.children.flatMap(contentEvents)];
}
