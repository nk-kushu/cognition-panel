import { ExecutionDetails } from "./ExecutionDetails";
import { Button, Empty, Segmented, Tag, Tooltip } from "antd";
import { IconArrowNarrowDown } from "@tabler/icons-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { AppIcon } from "./internal/AppIcon";
import {
  ArtifactIcon,
  ContextIcon,
  MemoryIcon,
  ModelCallIcon,
  NotebookIcon,
  TraceIcon,
} from "./internal/icons";
import { borderAll, borderB, borderL } from "./internal/styles";
import { formatDuration } from "./debugEventView";
import { formatBytes, formatCount } from "./debugTrace";
import type {
  ArtifactItem,
  ContextModel,
  ContextSession,
  ContextTurn,
  ContextUnit,
  Segment,
} from "./contextModel";

/** Fixed colors per origin; observations get one color per tool. */
const ORIGIN_COLORS: Readonly<Record<string, string | undefined>> = {
  instructions: "#64748b",
  task: "#9b6cc4",
  assistant: "#4f8fc0",
  base: "#8a8fa8",
  "obs.notebook": "#2f9e5b",
  "obs.correction": "#d14d4d",
  "obs.rejected": "#d14d4d",
};
const TOOL_COLORS = ["#d9734f", "#cb8a00", "#0f8f90", "#c2417a", "#5b8c2a", "#a8652a", "#7c6fd6"];

function colorOf(key: string, tools: readonly string[]): string {
  const known = ORIGIN_COLORS[key];
  if (known) return known;
  const index = tools.indexOf(key);
  return TOOL_COLORS[(index < 0 ? 0 : index) % TOOL_COLORS.length] ?? "#d9734f";
}

function amount(value: number, unit: ContextUnit): string {
  return unit === "bytes" ? formatBytes(value) : `${formatCount(value)} tok`;
}

const percent = (value: number) =>
  `${value < 0.1 ? (value * 100).toFixed(2) : (value * 100).toFixed(1)}%`;

type Scale = "run" | "window";

type ContextViewProps = Readonly<{
  model: ContextModel;
  selectedTurn: string | null;
  onSelectTurn: (spanId: string) => void;
  /** Opens the span in the Trace view. */
  onOpenTrace: (spanId: string) => void;
}>;

/**
 * The context the model worked with, turn by turn: how the window filled up and with what, where
 * notes, artifacts, compression and long-term memory came in, and what one step handed the next.
 */
export function ContextView({ model, selectedTurn, onSelectTurn, onOpenTrace }: ContextViewProps) {
  const [scale, setScale] = useState<Scale>("run");
  const tools = useMemo(() => {
    const keys = new Set<string>();
    for (const session of model.sessions)
      for (const turn of session.turns)
        for (const segment of turn.segments)
          if (segment.key.startsWith("obs.") && !ORIGIN_COLORS[segment.key]) keys.add(segment.key);
    return [...keys];
  }, [model]);
  const turns = model.sessions.flatMap((session) =>
    session.turns.map((turn) => ({ session, turn })),
  );
  const selected = turns.find(({ turn }) => turn.spanId === selectedTurn) ?? turns.at(-1) ?? null;
  const hasWindow = turns.some(({ turn }) => turn.budget !== null);

  if (model.sessions.length === 0)
    return (
      <Empty
        className="kxd:mt-12"
        description="No agentic session recorded yet: the context view fills in once a mind unit runs its first turn."
      />
    );

  return (
    <div className="kxd:grid kxd:h-full kxd:min-h-0 kxd:grid-cols-1 kxd:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] kxd:lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] kxd:lg:grid-rows-1">
      <div className="kxd:min-h-0 kxd:overflow-auto kxd:px-4 kxd:py-3">
        <ConceptStrip model={model} />
        <div className="kxd:mt-4 kxd:mb-2 kxd:flex kxd:flex-wrap kxd:items-center kxd:gap-3">
          <Legend model={model} tools={tools} />
          {hasWindow && (
            <Segmented<Scale>
              size="small"
              className="kxd:ml-auto"
              value={scale}
              onChange={setScale}
              options={[
                { value: "run", label: "Fit to run" },
                { value: "window", label: "Model window" },
              ]}
            />
          )}
        </div>
        {!model.measured && (
          <p className="kxd:m-0 kxd:mb-3 kxd:rounded-md kxd:bg-warning/10 kxd:px-3 kxd:py-2 kxd:text-xs kxd:text-text-muted">
            This run was recorded before kushibot measured its context window, so the composition is{" "}
            <b>estimated from the provider's input tokens</b>: the first call is the base, and each
            later increase is credited to the previous turn's action and its result. New runs record
            exact sizes per message.
          </p>
        )}
        {model.sessions.map((session, index) => (
          <Fragment key={session.spanId}>
            {index > 0 && <Handoff from={model.sessions[index - 1]!} to={session} />}
            <SessionBlock
              session={session}
              scale={scale}
              tools={tools}
              runPeak={Math.max(
                ...model.sessions.filter((s) => s.unit === session.unit).map((s) => s.peak),
                1,
              )}
              selected={selected?.turn.spanId ?? null}
              onSelect={onSelectTurn}
            />
          </Fragment>
        ))}
        <ArtifactsPanel model={model} onOpenTrace={onOpenTrace} />
        <MachineryPanel model={model} onOpenTrace={onOpenTrace} />
      </div>
      <aside
        aria-label="Turn context details"
        className={`kxd:min-h-0 kxd:overflow-auto kxd:bg-surface-muted ${borderL} kxd:max-lg:border-t kxd:max-lg:border-l-0 kxd:max-lg:border-solid kxd:max-lg:border-border`}
      >
        {selected && (
          <TurnInspector
            session={selected.session}
            turn={selected.turn}
            tools={tools}
            onOpenTrace={onOpenTrace}
          />
        )}
      </aside>
    </div>
  );
}

/** One card per concept with what it did in this run. */
function ConceptStrip({ model }: Readonly<{ model: ContextModel }>) {
  const turns = model.sessions.flatMap((session) => session.turns);
  const fills = turns.map((turn) => turn.fill).filter((fill): fill is number => fill !== null);
  const input = turns.reduce((sum, turn) => sum + (turn.usage?.input ?? 0), 0);
  const cached = turns.reduce((sum, turn) => sum + (turn.usage?.cached ?? 0), 0);
  const peakTokens = Math.max(0, ...turns.map((turn) => turn.usage?.input ?? 0));
  const notes = model.sessions.reduce((sum, session) => sum + session.notebookEntries, 0);
  const artifactBytes = model.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  const compressed = model.compressions.filter((item) => item.state === "prepared").length;
  const recalled = model.recalls.reduce((sum, item) => sum + item.recalled.length, 0);
  const cards: readonly Readonly<{
    icon: typeof ContextIcon;
    color: string;
    title: string;
    value: string;
    about: string;
    muted?: boolean;
  }>[] = [
    {
      icon: ContextIcon,
      color: "#7c6fd6",
      title: "Context window",
      value: fills.length
        ? `peak ${percent(Math.max(...fills))} full`
        : `peak ${formatCount(peakTokens)} tokens`,
      about:
        "Each turn re-sends the whole conversation: instructions, the task, every model action and every tool result so far. It only grows; when it no longer fits the model window the session stops.",
    },
    {
      icon: ModelCallIcon,
      color: "#4f8fc0",
      title: "Prompt cache",
      value: input ? `${percent(cached / input)} of input cached` : "no usage reported",
      about:
        "The provider reuses the unchanged prefix of the conversation. Cached input tokens are cheaper and faster; the growing tail is processed fresh.",
    },
    {
      icon: NotebookIcon,
      color: "#2f9e5b",
      title: "Notebook",
      value: notes ? `${notes} ${notes === 1 ? "entry" : "entries"}` : "no notes written",
      muted: notes === 0,
      about:
        "The session's working memory: short notes the model chooses to keep. They are what a stopped session hands back as its partial summary.",
    },
    {
      icon: ArtifactIcon,
      color: "#0f8f90",
      title: "Artifacts",
      value: model.artifacts.length
        ? `${model.artifacts.length} stored · ${formatBytes(artifactBytes)}`
        : model.collected
          ? `${model.collected.count} collected`
          : "none recorded",
      muted: model.artifacts.length === 0 && !model.collected?.count,
      about:
        "Durable outputs kept outside the context (for example each changed file's before/after). The context and results carry only their ids.",
    },
    {
      icon: ContextIcon,
      color: "#7c6fd6",
      title: "Compression",
      value: model.compressions.length
        ? `${compressed}/${model.compressions.length} applied`
        : model.limitHits
          ? "window full, no compression"
          : "not used",
      muted: model.compressions.length === 0,
      about: model.compressions.length
        ? "Contiguous observations were replaced by a verified summary stored as an artifact, when that measurably shrank the request."
        : "This agent does not wire kushibot's ContextCompressionService: the conversation is kept whole until it hits the window limit.",
    },
    {
      icon: MemoryIcon,
      color: "#2f9e5b",
      title: "Long-term memory",
      value: model.recalls.length ? `${recalled} recalled` : "not used",
      muted: model.recalls.length === 0,
      about: model.recalls.length
        ? "Accepted memories retrieved by topic and re-verified against their sources before entering the context."
        : "This agent does not wire kushibot's MemoryRetrievalService: nothing from earlier runs entered the context.",
    },
  ];
  return (
    <div className="kxd:grid kxd:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] kxd:gap-2">
      {cards.map((card) => (
        <Tooltip key={card.title} title={card.about}>
          <div
            className={`kxd:flex kxd:min-w-0 kxd:cursor-help kxd:flex-col kxd:gap-0.5 kxd:rounded-lg kxd:bg-fill kxd:px-3 kxd:py-2 ${card.muted ? "kxd:opacity-60" : ""}`}
          >
            <span className="kxd:flex kxd:items-center kxd:gap-1.5 kxd:text-[11px] kxd:text-text-muted">
              <span style={{ color: card.color }} className="kxd:inline-flex">
                <AppIcon icon={card.icon} size="sm" />
              </span>
              {card.title}
            </span>
            <span className="kxd:text-[13px] kxd:leading-snug kxd:font-semibold">{card.value}</span>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

function Legend({ model, tools }: Readonly<{ model: ContextModel; tools: readonly string[] }>) {
  const items: [string, string][] = model.measured
    ? [
        ["instructions", "Instructions"],
        ["task", "Task input"],
        ["assistant", "Model actions"],
      ]
    : [["base", "Instructions + task (first call)"]];
  for (const key of tools) items.push([key, key.replace(/^obs\.tool\./, "").replace(/^obs\./, "")]);
  return (
    <ul
      aria-label="Legend"
      className="kxd:m-0 kxd:flex kxd:list-none kxd:flex-wrap kxd:gap-x-3 kxd:gap-y-1 kxd:p-0 kxd:text-xs kxd:text-text-muted"
    >
      {items.map(([key, label]) => (
        <li key={key} className="kxd:inline-flex kxd:items-center kxd:gap-1.5">
          <span
            className="kxd:size-2.5 kxd:rounded-sm"
            style={{ background: colorOf(key, tools) }}
          />
          {label}
        </li>
      ))}
      <li className="kxd:inline-flex kxd:items-center kxd:gap-1.5">
        <span className="kxd:size-2.5 kxd:rounded-sm" style={addedStyle("#8a8fa8")} />
        new this turn
      </li>
    </ul>
  );
}

function addedStyle(color: string) {
  return {
    background: `repeating-linear-gradient(135deg, ${color} 0 4px, color-mix(in srgb, ${color} 55%, transparent) 4px 7px)`,
  };
}

function SessionBlock({
  session,
  scale,
  tools,
  runPeak,
  selected,
  onSelect,
}: Readonly<{
  session: ContextSession;
  scale: Scale;
  tools: readonly string[];
  runPeak: number;
  selected: string | null;
  onSelect: (spanId: string) => void;
}>) {
  return (
    <section
      aria-label={`Session ${session.step ?? session.sessionId}`}
      className={`kxd:mb-2 kxd:rounded-lg ${borderAll}`}
    >
      <header
        className={`kxd:flex kxd:flex-wrap kxd:items-center kxd:gap-2 kxd:px-3 kxd:py-2 ${borderB}`}
      >
        <span className="kxd:text-[13px] kxd:font-semibold">Step “{session.step ?? "?"}”</span>
        {session.mode && (
          <Tag bordered={false} className="kxd:m-0">
            {session.mode}
          </Tag>
        )}
        <span className="kxd:text-xs kxd:text-text-muted">
          session {session.sessionId.slice(0, 8)} · {session.turns.length}{" "}
          {session.turns.length === 1 ? "turn" : "turns"}
          {session.instructionsBytes !== null &&
            ` · starts with ${formatBytes(session.instructionsBytes)} instructions + ${formatBytes(session.inputBytes ?? 0)} task`}
        </span>
        {session.outcome && (
          <Tag
            bordered={false}
            color={
              session.outcome === "completed" || session.outcome === "accepted"
                ? "success"
                : "warning"
            }
            className="kxd:m-0 kxd:ml-auto"
          >
            {session.outcome}
          </Tag>
        )}
      </header>
      <ol aria-label="Turns" className="kxd:m-0 kxd:list-none kxd:p-0 kxd:py-1">
        {session.turns.map((turn) => (
          <TurnRow
            key={turn.spanId}
            turn={turn}
            max={scale === "window" && turn.budget ? turn.budget : runPeak}
            scale={scale}
            tools={tools}
            selected={turn.spanId === selected}
            onSelect={onSelect}
          />
        ))}
      </ol>
      {session.notebookEntries > 0 && (
        <div className="kxd:flex kxd:items-center kxd:gap-1.5 kxd:px-3 kxd:pb-2 kxd:text-xs kxd:text-text-muted">
          <AppIcon icon={NotebookIcon} size="sm" />
          Notebook at the end: {session.notebookEntries} entries ·{" "}
          {formatBytes(session.notebookBytes)}
        </div>
      )}
    </section>
  );
}

function TurnRow({
  turn,
  max,
  scale,
  tools,
  selected,
  onSelect,
}: Readonly<{
  turn: ContextTurn;
  max: number;
  scale: Scale;
  tools: readonly string[];
  selected: boolean;
  onSelect: (spanId: string) => void;
}>) {
  // On the window scale, the bar shows kushibot's size bound against the budget.
  const total =
    scale === "window" && turn.tokenUpperBound !== null ? turn.tokenUpperBound : turn.total;
  const width = Math.max(0.4, Math.min(100, (total / Math.max(1, max)) * 100));
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(turn.spanId)}
        className={`kxd:flex kxd:w-full kxd:cursor-pointer kxd:items-center kxd:gap-3 kxd:border-0 kxd:px-3 kxd:py-1 kxd:text-left kxd:text-text ${selected ? "kxd:bg-primary/10" : "kxd:bg-transparent kxd:hover:bg-fill"}`}
      >
        <span className="kxd:w-7 kxd:shrink-0 kxd:font-mono kxd:text-xs kxd:text-text-muted">
          T{turn.number}
        </span>
        <span className="kxd:relative kxd:h-4 kxd:min-w-0 kxd:flex-1 kxd:overflow-hidden kxd:rounded kxd:bg-fill">
          <span
            className="kxd:absolute kxd:inset-y-0 kxd:left-0 kxd:flex"
            style={{ width: `${width}%` }}
          >
            {turn.segments.map((segment, index) => (
              <SegmentBar
                key={`${segment.key}-${index}`}
                segment={segment}
                share={turn.total ? segment.value / turn.total : 0}
                unit={turn.unit}
                color={colorOf(segment.key, tools)}
              />
            ))}
          </span>
          {turn.overLimit && (
            <span className="kxd:absolute kxd:inset-y-0 kxd:right-0 kxd:w-1 kxd:bg-error" />
          )}
        </span>
        <span className="kxd:flex kxd:w-20 kxd:shrink-0 kxd:flex-col kxd:text-right kxd:font-mono kxd:text-xs kxd:leading-tight kxd:tabular-nums">
          {amount(turn.total, turn.unit)}
          {turn.addedValue > 0 && (
            <span className="kxd:text-[10px] kxd:text-text-muted">
              +{amount(turn.addedValue, turn.unit)}
            </span>
          )}
        </span>
        <Tooltip
          title={
            turn.fill !== null
              ? "Share of the model window this call used"
              : "Share of input tokens served from the provider's prompt cache"
          }
        >
          <span className="kxd:hidden kxd:w-12 kxd:shrink-0 kxd:text-right kxd:font-mono kxd:text-[11px] kxd:text-text-muted kxd:tabular-nums kxd:sm:block">
            {turn.fill !== null
              ? percent(turn.fill)
              : turn.usage && turn.usage.input
                ? `${Math.round((turn.usage.cached / turn.usage.input) * 100)}%`
                : ""}
          </span>
        </Tooltip>
        <span className="kxd:flex kxd:w-32 kxd:shrink-0 kxd:items-center kxd:gap-1 kxd:overflow-hidden kxd:text-xs">
          <ActionChip turn={turn} />
          {turn.notebook && (
            <Tooltip
              title={`Notebook: ${turn.notebook.entries} entries, ${formatBytes(turn.notebook.bytes)}`}
            >
              <span className="kxd:inline-flex kxd:text-[#2f9e5b]">
                <AppIcon icon={NotebookIcon} size="sm" />
              </span>
            </Tooltip>
          )}
          {turn.artifacts.length > 0 && (
            <Tooltip title={`${turn.artifacts.length} artifact(s) stored`}>
              <span className="kxd:inline-flex kxd:items-center kxd:text-[#0f8f90]">
                <AppIcon icon={ArtifactIcon} size="sm" />
                {turn.artifacts.length > 1 && turn.artifacts.length}
              </span>
            </Tooltip>
          )}
        </span>
      </button>
    </li>
  );
}

function SegmentBar({
  segment,
  share,
  unit,
  color,
}: Readonly<{ segment: Segment; share: number; unit: ContextUnit; color: string }>) {
  return (
    <Tooltip
      title={`${segment.added ? "New: " : ""}${segment.label} — ${amount(segment.value, unit)} (${percent(share)})`}
    >
      <span
        className={`kxd:h-full ${segment.added ? "kxd:outline kxd:outline-1 kxd:-outline-offset-1 kxd:outline-text" : ""}`}
        style={{
          width: `${share * 100}%`,
          minWidth: segment.value > 0 ? 2 : 0,
          ...(segment.added ? addedStyle(color) : { background: color }),
        }}
      />
    </Tooltip>
  );
}

function ActionChip({ turn }: Readonly<{ turn: ContextTurn }>) {
  if (turn.overLimit)
    return (
      <Tag bordered={false} color="error" className="kxd:m-0">
        window full
      </Tag>
    );
  const text =
    turn.action === "tool"
      ? `→ ${turn.tool ?? "tool"}`
      : turn.action === "note"
        ? "→ note"
        : turn.action === "final"
          ? `→ final${turn.acceptance ? ` · ${turn.acceptance}` : ""}`
          : turn.action === "invalid"
            ? "invalid action"
            : "…";
  const color =
    turn.action === "final"
      ? turn.acceptance === "accepted"
        ? "success"
        : "warning"
      : turn.action === "invalid" || turn.toolStatus === "failed" || turn.toolStatus === "rejected"
        ? "error"
        : undefined;
  return (
    <Tag bordered={false} color={color} className="kxd:m-0 kxd:truncate">
      {text}
    </Tag>
  );
}

/** What the accepted result of one step became in the next session. */
function Handoff({ from, to }: Readonly<{ from: ContextSession; to: ContextSession }>) {
  return (
    <div className="kxd:my-1 kxd:flex kxd:items-center kxd:gap-2 kxd:pl-4 kxd:text-xs kxd:text-text-muted">
      <span className="kxd:inline-flex kxd:text-[#9b6cc4]">
        <AppIcon icon={IconArrowNarrowDown} size="sm" />
      </span>
      <span>
        Handoff: “{from.step ?? "?"}” {from.outcome ?? "ended"}
        {from.resultBytes !== null && ` with a ${formatBytes(from.resultBytes)} result`}; the next
        session starts from a fresh context — only the accepted result
        {to.inputBytes !== null && ` (${formatBytes(to.inputBytes)} task input)`} carries over, not
        the conversation.
      </span>
    </div>
  );
}

function TurnInspector({
  session,
  turn,
  tools,
  onOpenTrace,
}: Readonly<{
  session: ContextSession;
  turn: ContextTurn;
  tools: readonly string[];
  onOpenTrace: (spanId: string) => void;
}>) {
  const ordered = [...turn.segments].sort((a, b) => b.value - a.value);
  return (
    <div className="kxd:flex kxd:flex-col kxd:gap-4 kxd:p-4">
      <div className="kxd:flex kxd:items-start kxd:gap-2">
        <div className="kxd:min-w-0 kxd:flex-1">
          <div className="kxd:text-[11px] kxd:font-medium kxd:tracking-wide kxd:text-text-muted kxd:uppercase">
            Step “{session.step ?? "?"}” · turn {turn.number}
          </div>
          <div className="kxd:text-sm kxd:font-semibold">
            Context sent to the model: {amount(turn.total, turn.unit)}
          </div>
          {turn.durationMs !== null && (
            <div className="kxd:text-xs kxd:text-text-muted">
              turn took {formatDuration(turn.durationMs)}
            </div>
          )}
        </div>
        <Tooltip title="Show this turn in the trace">
          <Button
            size="small"
            type="text"
            onClick={() => onOpenTrace(turn.spanId)}
            icon={<AppIcon icon={TraceIcon} label="Show in trace" />}
          />
        </Tooltip>
      </div>

      {turn.budget !== null && turn.tokenUpperBound !== null && (
        <Section title="Window">
          <Meter
            value={turn.tokenUpperBound}
            max={turn.budget}
            color={turn.overLimit ? "#d14d4d" : "#7c6fd6"}
            label={`≤${formatCount(turn.tokenUpperBound)} of ${formatCount(turn.budget)} tokens (${percent(turn.fill ?? 0)})`}
          />
          <p className="kxd:m-0 kxd:mt-1 kxd:text-[11px] kxd:text-text-muted">
            kushibot bounds tokens by request bytes + 1 KB; the budget is the model's context minus
            the reply allowance.
          </p>
        </Section>
      )}

      <Section title={turn.unit === "bytes" ? "Composition (measured)" : "Composition (estimated)"}>
        <ul className="kxd:m-0 kxd:flex kxd:list-none kxd:flex-col kxd:gap-1 kxd:p-0">
          {ordered.map((segment, index) => (
            <li
              key={`${segment.key}-${index}`}
              className="kxd:flex kxd:items-center kxd:gap-2 kxd:text-xs"
            >
              <span
                className="kxd:size-2.5 kxd:shrink-0 kxd:rounded-sm"
                style={
                  segment.added
                    ? addedStyle(colorOf(segment.key, tools))
                    : { background: colorOf(segment.key, tools) }
                }
              />
              <span className="kxd:min-w-0 kxd:flex-1 kxd:truncate">
                {segment.added && <b>new · </b>}
                {segment.label}
              </span>
              <span className="kxd:font-mono kxd:tabular-nums">
                {amount(segment.value, turn.unit)}
              </span>
              <span className="kxd:w-12 kxd:text-right kxd:font-mono kxd:text-text-muted kxd:tabular-nums">
                {turn.total ? percent(segment.value / turn.total) : ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {turn.messageList.length > 0 && (
        <Section title={`Messages (${turn.messages ?? turn.messageList.length})`}>
          <ol className="kxd:m-0 kxd:flex kxd:list-none kxd:flex-col kxd:gap-0.5 kxd:p-0">
            {turn.messages !== null && turn.messages > turn.messageList.length && (
              <li className="kxd:text-[11px] kxd:text-text-muted">
                … {turn.messages - turn.messageList.length} earlier messages
              </li>
            )}
            {turn.messageList.map((message) => {
              const key = message.kind === "observation" ? `obs.${message.source}` : message.kind;
              return (
                <li
                  key={message.index}
                  className={`kxd:flex kxd:items-center kxd:gap-2 kxd:rounded kxd:px-1 kxd:text-xs ${message.added ? "kxd:bg-primary/10" : ""}`}
                >
                  <span className="kxd:w-6 kxd:font-mono kxd:text-text-muted">
                    #{message.index}
                  </span>
                  <span
                    className="kxd:size-2 kxd:shrink-0 kxd:rounded-full"
                    style={{ background: colorOf(key, tools) }}
                  />
                  <span className="kxd:w-14 kxd:text-text-muted">
                    {message.kind === "assistant"
                      ? "model"
                      : message.kind === "task"
                        ? "task"
                        : message.source.startsWith("tool.")
                          ? "tool"
                          : "runtime"}
                  </span>
                  <span className="kxd:min-w-0 kxd:flex-1 kxd:truncate">
                    {message.kind === "task"
                      ? "task input"
                      : message.kind === "assistant"
                        ? `action ${message.source}`
                        : `observation ${message.source}`}
                  </span>
                  <span className="kxd:font-mono kxd:tabular-nums">
                    {formatBytes(message.bytes)}
                  </span>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      {turn.usage && (
        <Section title="Provider usage">
          <Meter
            value={turn.usage.cached}
            max={Math.max(1, turn.usage.input)}
            color="#4f8fc0"
            label={`${formatCount(turn.usage.cached)} cached of ${formatCount(turn.usage.input)} input tokens`}
          />
          <dl className="kxd:m-0 kxd:mt-2 kxd:grid kxd:grid-cols-2 kxd:gap-x-3 kxd:gap-y-0.5 kxd:text-xs">
            <Stat label="Input" value={formatCount(turn.usage.input)} />
            <Stat
              label="Uncached input"
              value={formatCount(turn.usage.input - turn.usage.cached)}
            />
            <Stat label="Output" value={formatCount(turn.usage.output)} />
            <Stat label="Reasoning" value={formatCount(turn.usage.reasoning)} />
          </dl>
        </Section>
      )}

      <ExecutionDetails events={turn.detailEvents ?? []} />

      <Section title="What the turn did">
        <div className="kxd:flex kxd:flex-wrap kxd:items-center kxd:gap-1.5 kxd:text-xs">
          <ActionChip turn={turn} />
          {turn.toolStatus && <span className="kxd:text-text-muted">tool {turn.toolStatus}</span>}
        </div>
        <p className="kxd:m-0 kxd:mt-1 kxd:text-[11px] kxd:text-text-muted">
          {turn.action === "tool"
            ? "The tool's result is appended to the context and sent with the next model call."
            : turn.action === "note"
              ? "The note goes into the session notebook; the model sees an acknowledgement next turn."
              : turn.action === "final"
                ? "The final result is checked by the result contract and the acceptance policy."
                : ""}
        </p>
        {turn.notebook && (
          <div className="kxd:mt-2 kxd:flex kxd:items-center kxd:gap-1.5 kxd:text-xs">
            <span className="kxd:inline-flex kxd:text-[#2f9e5b]">
              <AppIcon icon={NotebookIcon} size="sm" />
            </span>
            {turn.notebook.full
              ? "Notebook full — note dropped"
              : `Notebook now ${turn.notebook.entries} entries, ${formatBytes(turn.notebook.bytes)}`}
          </div>
        )}
        {turn.artifacts.map((artifact) => (
          <ArtifactLine key={artifact.spanId} artifact={artifact} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section>
      <h3 className="kxd:m-0 kxd:mb-1.5 kxd:text-[11px] kxd:font-medium kxd:tracking-wide kxd:text-text-muted kxd:uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Meter({
  value,
  max,
  color,
  label,
}: Readonly<{ value: number; max: number; color: string; label: string }>) {
  const share = Math.min(1, value / Math.max(1, max));
  return (
    <div>
      <div className="kxd:h-2 kxd:overflow-hidden kxd:rounded-full kxd:bg-fill">
        <div
          className="kxd:h-full kxd:rounded-full"
          style={{ width: `max(2px, ${share * 100}%)`, background: color }}
        />
      </div>
      <div className="kxd:mt-1 kxd:text-xs kxd:tabular-nums">{label}</div>
    </div>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <>
      <dt className="kxd:text-text-muted">{label}</dt>
      <dd className="kxd:m-0 kxd:text-right kxd:font-mono kxd:tabular-nums">{value}</dd>
    </>
  );
}

function ArtifactLine({ artifact }: Readonly<{ artifact: ArtifactItem }>) {
  return (
    <div className="kxd:mt-1 kxd:flex kxd:items-center kxd:gap-1.5 kxd:text-xs">
      <span className="kxd:inline-flex kxd:text-[#0f8f90]">
        <AppIcon icon={ArtifactIcon} size="sm" />
      </span>
      <span className="kxd:min-w-0 kxd:flex-1 kxd:truncate">
        {artifact.kind} <span className="kxd:font-mono">#{artifact.id.slice(0, 8)}</span>
      </span>
      <span className="kxd:font-mono kxd:tabular-nums">{formatBytes(artifact.bytes)}</span>
    </div>
  );
}

function ArtifactsPanel({
  model,
  onOpenTrace,
}: Readonly<{ model: ContextModel; onOpenTrace: (spanId: string) => void }>) {
  return (
    <Panel
      icon={ArtifactIcon}
      color="#0f8f90"
      title="Artifacts"
      hint="Stored outside the context; results and the next step see only their ids."
    >
      {model.artifacts.length === 0 ? (
        <p className="kxd:m-0 kxd:text-xs kxd:text-text-muted">
          {model.collected
            ? `No artifact writes were traced; the run collected ${model.collected.count}.`
            : "No artifact writes recorded. Runs recorded before artifact tracing, or that changed no files, show none."}
        </p>
      ) : (
        <table className="kxd:w-full kxd:border-collapse kxd:text-xs">
          <thead>
            <tr className="kxd:text-left kxd:text-[11px] kxd:text-text-muted">
              <th className="kxd:py-1 kxd:font-medium">Kind</th>
              <th className="kxd:py-1 kxd:font-medium">Id</th>
              <th className="kxd:py-1 kxd:font-medium">Written in</th>
              <th className="kxd:py-1 kxd:text-right kxd:font-medium">Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.artifacts.map((artifact) => {
              const session = model.sessions.find((s) => s.sessionId === artifact.sessionId);
              return (
                <tr key={artifact.spanId} className={borderB}>
                  <td className="kxd:py-1">{artifact.kind}</td>
                  <td className="kxd:py-1 kxd:font-mono">
                    <Tooltip
                      title={[
                        artifact.id,
                        artifact.media,
                        artifact.digest && `sha256 ${artifact.digest}…`,
                        ...artifact.sources.map((s) => `from ${s}`),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {artifact.id.slice(0, 12)}
                    </Tooltip>
                  </td>
                  <td className="kxd:py-1 kxd:text-text-muted">
                    {artifact.turn !== null
                      ? `“${session?.step ?? "?"}” T${artifact.turn}`
                      : "workflow"}
                  </td>
                  <td className="kxd:py-1 kxd:text-right kxd:font-mono kxd:tabular-nums">
                    {formatBytes(artifact.bytes)}
                  </td>
                  <td className="kxd:py-1 kxd:text-right">
                    <Button size="small" type="link" onClick={() => onOpenTrace(artifact.spanId)}>
                      trace
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {model.collected && (
        <p className="kxd:m-0 kxd:mt-2 kxd:text-xs kxd:text-text-muted">
          At the end the run returned {model.collected.count} artifact reference
          {model.collected.count === 1 ? "" : "s"} with its result.
        </p>
      )}
    </Panel>
  );
}

/** Compression, composition and long-term memory: shown when used, explained when not. */
function MachineryPanel({
  model,
  onOpenTrace,
}: Readonly<{ model: ContextModel; onOpenTrace: (spanId: string) => void }>) {
  return (
    <div className="kxd:grid kxd:grid-cols-1 kxd:gap-2 kxd:xl:grid-cols-2">
      <Panel
        icon={ContextIcon}
        color="#7c6fd6"
        title="Compression & composition"
        hint="kushibot ContextCompressionService · AgentContextComposer"
      >
        {model.compressions.length === 0 && model.compositions.length === 0 ? (
          <p className="kxd:m-0 kxd:text-xs kxd:text-text-muted">
            Not used by this agent. Its sessions append every action and result to one growing
            conversation
            {model.limitHits
              ? `, and ${model.limitHits} session${model.limitHits === 1 ? "" : "s"} stopped because the window was full`
              : "; no session came near the window limit"}
            . Wiring the compression service would replace runs of old observations with a verified
            summary artifact.
          </p>
        ) : (
          <ul className="kxd:m-0 kxd:flex kxd:list-none kxd:flex-col kxd:gap-2 kxd:p-0">
            {model.compressions.map((item) => (
              <li key={item.spanId} className="kxd:text-xs">
                <button
                  type="button"
                  onClick={() => onOpenTrace(item.spanId)}
                  className="kxd:cursor-pointer kxd:border-0 kxd:bg-transparent kxd:p-0 kxd:text-left kxd:text-text kxd:hover:text-primary"
                >
                  <b>Compression {item.state}</b>
                  {item.code && ` (${item.code})`}
                </button>
                {item.metrics.beforeTokens !== undefined && (
                  <BeforeAfter
                    before={item.metrics.beforeTokens}
                    after={item.metrics.afterTokens ?? 0}
                  />
                )}
                {item.replaced.length > 0 && (
                  <div className="kxd:text-text-muted">
                    {item.replaced.length} observations → 1 summary (
                    {item.metrics.summaryPoints ?? "?"} points)
                  </div>
                )}
              </li>
            ))}
            {model.compositions.map((item) => (
              <li key={item.spanId} className="kxd:text-xs">
                <button
                  type="button"
                  onClick={() => onOpenTrace(item.spanId)}
                  className="kxd:cursor-pointer kxd:border-0 kxd:bg-transparent kxd:p-0 kxd:text-left kxd:text-text kxd:hover:text-primary"
                >
                  <b>Composition {item.state}</b>
                  {item.code && ` (${item.code})`}
                </button>
                <div className="kxd:text-text-muted">
                  {item.included.length} fragments in · {item.dropped.length} dropped to fit ·{" "}
                  {item.omitted.length} not chosen
                  {item.metrics.tokenUpperBound !== undefined &&
                    ` · ≤${formatCount(item.metrics.tokenUpperBound)} of ${formatCount(item.metrics.maxInputTokens ?? 0)} tokens`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        icon={MemoryIcon}
        color="#2f9e5b"
        title="Long-term memory"
        hint="kushibot's MemoryRetrievalService"
      >
        {model.recalls.length === 0 ? (
          <p className="kxd:m-0 kxd:text-xs kxd:text-text-muted">
            Not used by this agent: no memories from earlier runs were recalled. Within a run, the
            only memory is each session's notebook and the conversation itself.
          </p>
        ) : (
          <ul className="kxd:m-0 kxd:flex kxd:list-none kxd:flex-col kxd:gap-1 kxd:p-0">
            {model.recalls.map((item) => (
              <li key={item.spanId} className="kxd:text-xs">
                <button
                  type="button"
                  onClick={() => onOpenTrace(item.spanId)}
                  className="kxd:cursor-pointer kxd:border-0 kxd:bg-transparent kxd:p-0 kxd:text-left kxd:text-text kxd:hover:text-primary"
                >
                  “{item.topic ?? "?"}”: {item.recalled.length} recalled, {item.skipped.length}{" "}
                  stale
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function BeforeAfter({ before, after }: Readonly<{ before: number; after: number }>) {
  const max = Math.max(before, after, 1);
  return (
    <div className="kxd:mt-1 kxd:flex kxd:flex-col kxd:gap-0.5">
      {(
        [
          ["before", before, "#8a8fa8"],
          ["after", after, "#7c6fd6"],
        ] as const
      ).map(([label, value, color]) => (
        <div key={label} className="kxd:flex kxd:items-center kxd:gap-2">
          <span className="kxd:w-10 kxd:text-text-muted">{label}</span>
          <span className="kxd:h-2 kxd:flex-1 kxd:overflow-hidden kxd:rounded-full kxd:bg-fill">
            <span
              className="kxd:block kxd:h-full kxd:rounded-full"
              style={{ width: `${(value / max) * 100}%`, background: color }}
            />
          </span>
          <span className="kxd:w-16 kxd:text-right kxd:font-mono kxd:tabular-nums">
            {formatCount(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Panel({
  icon,
  color,
  title,
  hint,
  children,
}: Readonly<{
  icon: typeof ContextIcon;
  color: string;
  title: string;
  hint: string;
  children: ReactNode;
}>) {
  return (
    <section className={`kxd:mt-2 kxd:rounded-lg kxd:px-3 kxd:py-2 ${borderAll}`}>
      <h3 className="kxd:m-0 kxd:mb-1.5 kxd:flex kxd:flex-wrap kxd:items-center kxd:gap-x-1.5 kxd:text-[13px] kxd:font-semibold">
        <span className="kxd:inline-flex" style={{ color }}>
          <AppIcon icon={icon} size="sm" />
        </span>
        {title}
        <span className="kxd:min-w-0 kxd:text-[11px] kxd:font-normal kxd:break-words kxd:text-text-muted">
          {hint}
        </span>
      </h3>
      {children}
    </section>
  );
}
