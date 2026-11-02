import {
  Alert,
  Button,
  Empty,
  Input,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { AgentRunStatus, DebugEventsViewerProps } from "./types";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppIcon } from "./internal/AppIcon";
import {
  BackIcon,
  ContextIcon,
  DebugEventsIcon,
  EventListIcon,
  RefreshIcon,
  SearchIcon,
  TraceIcon,
} from "./internal/icons";
import { borderB } from "./internal/styles";
import { LEVELS, filterEvents, formatDuration, type DebugLevel } from "./debugEventView";
import {
  allSpanIds,
  ancestorIds,
  buildTrace,
  defaultCollapsed,
  formatCount,
  matchingSpans,
  traceStats,
  type TraceStats,
} from "./debugTrace";
import { buildContextModel } from "./contextModel";
import { ContextView } from "./ContextView";
import { EventList } from "./EventList";
import { TraceView } from "./TraceView";
import "./style.css";

const STATUS_COLORS: Record<AgentRunStatus, string> = {
  starting: "processing",
  running: "processing",
  paused: "warning",
  completed: "success",
  failed: "error",
  cancelled: "default",
};

type View = "trace" | "context" | "events";
/** How the tree folds: the default (turns folded), all open or all closed, plus rows the user flipped. */
type Folding = Readonly<{ base: "default" | "open" | "closed"; flipped: ReadonlySet<string> }>;

/**
 * What kushibot did during one chat run. The trace shows the harness as a tree — agent run,
 * workflow steps, executors, agentic mind units, turns, model and tool calls — and the event
 * list shows every recorded event in order.
 */
export function DebugEventsViewer({
  events,
  run = null,
  recording = true,
  loading = false,
  live = false,
  error = null,
  onRefresh,
  onBack,
  backLabel = "Back",
  recordingHelp = "Enable debug recording in the application supplying these events.",
}: DebugEventsViewerProps) {
  const { token } = theme.useToken();
  const style = Object.fromEntries(
    Object.entries(token).map(([key, value]) => [
      "--kxd-ant-" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()),
      value,
    ]),
  ) as CSSProperties;
  const [view, setView] = useState<View>("trace");
  const [query, setQuery] = useState("");
  const [minLevel, setMinLevel] = useState<DebugLevel>("trace");
  const [spans, setSpans] = useState(false);
  const [follow, setFollow] = useState(true);
  const [folding, setFolding] = useState<Folding>({ base: "default", flipped: new Set() });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTurn, setSelectedTurn] = useState<string | null>(null);

  const root = useMemo(() => buildTrace(events), [events]);
  const stats = useMemo(() => traceStats(root, events), [root, events]);
  const context = useMemo(() => buildContextModel(root, events), [root, events]);
  const keep = useMemo(() => matchingSpans(root, query), [root, query]);
  const collapsed = useMemo(() => {
    const base =
      folding.base === "default"
        ? defaultCollapsed(root)
        : folding.base === "closed"
          ? allSpanIds(root)
          : new Set<string>();
    for (const id of folding.flipped) if (!base.delete(id)) base.add(id);
    return base;
  }, [root, folding]);
  const shown = useMemo(
    () => filterEvents(events, { minLevel, query, spans }),
    [events, minLevel, query, spans],
  );
  const first = events[0]?.event.occurredAtEpochMs ?? 0;
  const bottomRef = useRef<HTMLDivElement>(null);
  // Until something is picked, the inspector shows the agent run.
  const selected = selectedId ?? root.children[0]?.id ?? "root";

  useEffect(() => {
    if (view === "events" && follow && live) bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [view, follow, live, shown.length]);

  const toggle = (id: string) =>
    setFolding(({ base, flipped }) => {
      const next = new Set(flipped);
      if (!next.delete(id)) next.add(id);
      return { base, flipped: next };
    });

  return (
    <div style={style} className="kxd:flex kxd:h-full kxd:flex-col kxd:bg-surface kxd:text-text">
      <header
        className={`kxd:flex kxd:shrink-0 kxd:flex-col kxd:gap-3 kxd:px-4 kxd:pt-3 kxd:pb-3 ${borderB}`}
      >
        <div className="kxd:flex kxd:flex-wrap kxd:items-center kxd:gap-2">
          {onBack && (
            <Tooltip title={backLabel}>
              <Button
                type="text"
                size="small"
                onClick={onBack}
                icon={<AppIcon icon={BackIcon} label={backLabel} />}
              />
            </Tooltip>
          )}
          <AppIcon icon={DebugEventsIcon} />
          <Typography.Title level={5} className="kxd:m-0">
            Run trace
          </Typography.Title>
          {run && (
            <>
              <span className="kxd:text-text-muted">·</span>
              <span className="kxd:font-semibold">{run.agentName}</span>
              {run.status ? (
                <Tag bordered={false} color={STATUS_COLORS[run.status]} className="kxd:m-0">
                  {run.status}
                </Tag>
              ) : (
                <Tooltip title="The server no longer holds this run; its stored events remain.">
                  <Tag bordered={false} className="kxd:m-0">
                    ended
                  </Tag>
                </Tooltip>
              )}
              <span className="kxd:text-xs kxd:text-text-muted">
                started {new Date(run.startedAt).toLocaleString()}
              </span>
            </>
          )}
          <div className="kxd:ml-auto kxd:flex kxd:items-center kxd:gap-2 kxd:text-xs kxd:text-text-muted">
            {live && (
              <span className="kxd:inline-flex kxd:items-center kxd:gap-1.5">
                <span className="kxd:size-1.5 kxd:animate-pulse kxd:rounded-full kxd:bg-primary" />
                live
              </span>
            )}
            <span aria-label="Event count">
              {events.length} {events.length === 1 ? "event" : "events"}
            </span>
            {onRefresh && (
              <Tooltip title="Fetch new events">
                <Button
                  type="text"
                  size="small"
                  onClick={onRefresh}
                  icon={<AppIcon icon={RefreshIcon} label="Refresh" />}
                />
              </Tooltip>
            )}
          </div>
        </div>
        {events.length > 0 && <StatsStrip stats={stats} />}
        <div className="kxd:flex kxd:flex-wrap kxd:items-center kxd:gap-3">
          <Segmented<View>
            size="small"
            value={view}
            onChange={setView}
            options={[
              { value: "trace", label: <ViewLabel icon={TraceIcon} text="Trace" /> },
              { value: "context", label: <ViewLabel icon={ContextIcon} text="Context" /> },
              { value: "events", label: <ViewLabel icon={EventListIcon} text="All events" /> },
            ]}
          />
          {view !== "context" && (
            <Input
              allowClear
              size="small"
              aria-label="Filter"
              placeholder={
                view === "trace"
                  ? "Find a step, executor, tool, model…"
                  : "Filter by text, operation, ref or id"
              }
              prefix={<AppIcon icon={SearchIcon} size="sm" />}
              className="kxd:max-w-80 kxd:min-w-48 kxd:flex-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          {view === "context" ? null : view === "trace" ? (
            <span className="kxd:flex kxd:items-center kxd:gap-1">
              <Button
                size="small"
                type="text"
                onClick={() => setFolding({ base: "open", flipped: new Set() })}
              >
                Expand all
              </Button>
              <Button
                size="small"
                type="text"
                onClick={() => setFolding({ base: "default", flipped: new Set() })}
              >
                Fold turns
              </Button>
            </span>
          ) : (
            <>
              <Select
                size="small"
                aria-label="Lowest level"
                value={minLevel}
                onChange={setMinLevel}
                className="kxd:w-32"
                options={LEVELS.map((level) => ({ value: level, label: `${level} and up` }))}
              />
              <span className="kxd:inline-flex kxd:items-center kxd:gap-1.5 kxd:text-xs kxd:text-text-muted">
                <Switch
                  size="small"
                  checked={spans}
                  onChange={setSpans}
                  aria-label="Show span starts"
                />
                Span starts
              </span>
              <span className="kxd:inline-flex kxd:items-center kxd:gap-1.5 kxd:text-xs kxd:text-text-muted">
                <Switch size="small" checked={follow} onChange={setFollow} aria-label="Follow" />
                Follow
              </span>
            </>
          )}
        </div>
      </header>
      {(error || !recording) && (
        <div className="kxd:px-4 kxd:pt-3">
          {error && <Alert className="kxd:mb-3" type="error" showIcon title={error} />}
          {!recording && (
            <Alert
              className="kxd:mb-3"
              type="info"
              showIcon
              title="Debug events are not recorded"
              description={recordingHelp}
            />
          )}
        </div>
      )}
      <div className="kxd:min-h-0 kxd:flex-1">
        {loading ? (
          <Spin className="kxd:mt-12 kxd:block" />
        ) : events.length === 0 ? (
          <Empty
            className="kxd:mt-12"
            description={
              live
                ? "Waiting for the agent's first debug event…"
                : "This run recorded no debug events. Agents record them by passing a debug recorder to kushibot's AgentRuntimeFactory."
            }
          />
        ) : view === "context" ? (
          <ContextView
            model={context}
            selectedTurn={selectedTurn}
            onSelectTurn={setSelectedTurn}
            onOpenTrace={(spanId) => {
              // Unfold the span's ancestors so the row is visible, then select it.
              const folded = defaultCollapsed(root);
              setQuery("");
              setFolding({
                base: "default",
                flipped: new Set(ancestorIds(root, spanId).filter((id) => folded.has(id))),
              });
              setSelectedId(spanId);
              setView("trace");
            }}
          />
        ) : view === "trace" ? (
          <TraceView
            root={root}
            collapsed={collapsed}
            keep={keep}
            selectedId={selected}
            onToggle={toggle}
            onSelect={setSelectedId}
          />
        ) : (
          <div className="kxd:h-full kxd:overflow-auto kxd:px-4 kxd:py-3">
            {shown.length === 0 ? (
              <Empty className="kxd:mt-12" description="No events match the filter." />
            ) : (
              <EventList events={shown} first={first} />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function ViewLabel({ icon, text }: Readonly<{ icon: typeof TraceIcon; text: string }>) {
  return (
    <span className="kxd:inline-flex kxd:items-center kxd:gap-1.5 kxd:px-1">
      <AppIcon icon={icon} size="sm" />
      {text}
    </span>
  );
}

function StatsStrip({ stats }: Readonly<{ stats: TraceStats }>) {
  const items: readonly (readonly [string, string, string?])[] = [
    ["Duration", formatDuration(stats.durationMs)],
    ["Steps", String(stats.steps)],
    ["Turns", String(stats.turns)],
    ["Model calls", String(stats.modelCalls), stats.models.join(", ") || undefined],
    ["Tool calls", String(stats.toolCalls)],
    ["Tokens", `${formatCount(stats.inputTokens)} in · ${formatCount(stats.outputTokens)} out`],
  ];
  return (
    <dl aria-label="Run summary" className="kxd:m-0 kxd:flex kxd:flex-wrap kxd:gap-2">
      {items.map(([label, value, hint]) => (
        <Tooltip key={label} title={hint}>
          <div className="kxd:flex kxd:min-w-24 kxd:flex-col kxd:rounded-lg kxd:bg-fill kxd:px-3 kxd:py-1.5">
            <dt className="kxd:text-[11px] kxd:text-text-muted">{label}</dt>
            <dd className="kxd:m-0 kxd:text-sm kxd:font-semibold kxd:tabular-nums">{value}</dd>
          </div>
        </Tooltip>
      ))}
      {stats.warnings + stats.errors > 0 && (
        <div className="kxd:flex kxd:min-w-24 kxd:flex-col kxd:rounded-lg kxd:bg-warning/10 kxd:px-3 kxd:py-1.5">
          <dt className="kxd:text-[11px] kxd:text-text-muted">Issues</dt>
          <dd className="kxd:m-0 kxd:text-sm kxd:font-semibold">
            <span className="kxd:text-warning">{stats.warnings} warn</span>
            {stats.errors > 0 && <span className="kxd:text-error"> · {stats.errors} error</span>}
          </dd>
        </div>
      )}
    </dl>
  );
}
