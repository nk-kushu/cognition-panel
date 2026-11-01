import { Alert, Space, Tag, Typography, theme } from "antd";
import { useId, useMemo, useState } from "react";
import { WorkflowLayout } from "./WorkflowLayout";
import type { WorkflowGraph, WorkflowSelection } from "./types";

export type WorkflowPanelProps = Readonly<{
  graph: WorkflowGraph;
  selection?: WorkflowSelection;
  onSelect?: (selection: WorkflowSelection) => void;
  /** Hosts with their own configuration inspector can hide the read-only details. */
  showDetails?: boolean;
}>;

/** Pure graph viewer: no requests, agent imports, or configuration persistence. */
export function WorkflowPanel({
  graph,
  selection,
  onSelect,
  showDetails = true,
}: WorkflowPanelProps) {
  const { token } = theme.useToken();
  const marker = useId().replace(/:/g, "");
  const layout = useMemo(() => new WorkflowLayout(graph), [graph]);
  const [local, setLocal] = useState<WorkflowSelection>({ kind: "graph" });
  const selected = selection ?? local;
  const choose = (next: WorkflowSelection) => {
    setLocal(next);
    onSelect?.(next);
  };
  const colors = [token.blue, token.purple, token.orange, token.green, token.cyan];
  const colorOf = (controlId?: string) =>
    colors[
      Math.max(0, graph.controls?.findIndex((item) => item.id === controlId) ?? 0) % colors.length
    ]!;
  const node =
    selected.kind === "step" ? graph.nodes.find((item) => item.id === selected.id) : undefined;
  if (layout.errors.length)
    return (
      <Alert type="error" title="Invalid workflow graph" description={layout.errors.join(" ")} />
    );
  if (!graph.nodes.length) return <Alert type="info" title="This workflow has no steps." />;
  return (
    <section
      aria-label={graph.title}
      style={{ minWidth: 0, maxWidth: "100%", width: layout.width }}
    >
      <Space wrap style={{ marginBottom: 16 }}>
        {(graph.controls ?? []).map((control) => (
          <button
            key={control.id}
            type="button"
            aria-pressed={selected.kind === "control" && selected.id === control.id}
            onClick={() => choose({ kind: "control", id: control.id })}
            style={{
              cursor: "pointer",
              border: `1px solid ${colorOf(control.id)}`,
              borderRadius: 16,
              padding: "4px 10px",
              color: token.colorText,
              background:
                selected.kind === "control" && selected.id === control.id
                  ? token.colorFillSecondary
                  : token.colorBgContainer,
            }}
          >
            {control.label}: {control.value}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={selected.kind === "graph"}
          onClick={() => choose({ kind: "graph" })}
          style={{
            cursor: "pointer",
            borderRadius: 16,
            padding: "4px 10px",
            border: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            color: token.colorText,
          }}
        >
          {graph.overview ?? "Whole workflow"}
        </button>
      </Space>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <div style={{ position: "relative", width: layout.width, height: layout.height }}>
          <svg
            aria-hidden
            width={layout.width}
            height={layout.height}
            style={{ position: "absolute", inset: 0 }}
          >
            <defs>
              {[token.colorTextTertiary, ...colors].map((color, index) => (
                <marker
                  key={index}
                  id={`${marker}-${index}`}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0 0L8 4L0 8Z" fill={color} />
                </marker>
              ))}
            </defs>
            {(graph.lanes ?? []).map((lane, index) => (
              <text
                key={lane.id}
                x={graph.presentation?.lanes?.[lane.id]?.x ?? index * 280 + 8}
                y={graph.presentation?.lanes?.[lane.id]?.y ?? 18}
                fill={token.colorTextSecondary}
                fontSize={12}
              >
                {lane.label}
              </text>
            ))}
            {graph.edges.map((edge, index) => {
              const colored = edge.kind === "return" || edge.kind === "retry";
              const color = colored ? colorOf(edge.controlId) : token.colorTextTertiary;
              const active =
                selected.kind === "graph" ||
                (selected.kind === "control" && edge.controlId === selected.id) ||
                (selected.kind === "step" &&
                  (edge.fromStepId === selected.id || edge.toStepId === selected.id));
              return (
                <g key={edge.id} data-route={edge.controlId} opacity={active ? 1 : 0.25}>
                  <title>
                    {[
                      edge.label,
                      edge.policy,
                      edge.maxTraversals !== undefined ? `Limit: ${edge.maxTraversals}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </title>
                  <path
                    d={layout.path(index)}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                    strokeDasharray={edge.kind === "stop" ? "4 3" : undefined}
                    markerEnd={`url(#${marker}-${colored ? colors.indexOf(color) + 1 : 0})`}
                  />
                </g>
              );
            })}
          </svg>
          {graph.nodes.map((step) => {
            const box = layout.boxes.get(step.id)!;
            const chosen = selected.kind === "step" && selected.id === step.id;
            const lane = graph.lanes?.find((item) => item.id === step.lane);
            const retry = graph.edges.find(
              (edge) => edge.fromStepId === step.id && edge.toStepId === step.id,
            );
            const skills = step.skills?.filter((item) => item.enabled !== false).length ?? 0;
            const guards = step.guards?.filter((item) => item.enabled !== false).length ?? 0;
            const attachments = [
              skills ? `${skills} skills` : "",
              guards ? `${guards} guards` : "",
              step.pauses ? "May wait" : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={step.id}
                style={{
                  position: "absolute",
                  left: box.x,
                  top: box.y,
                  width: box.width,
                  height: box.height,
                }}
              >
                <button
                  type="button"
                  title={step.description}
                  aria-label={
                    lane && step.kind !== "terminal" ? `${lane.label}: ${step.title}` : step.title
                  }
                  aria-pressed={chosen}
                  onClick={() => choose({ kind: "step", id: step.id })}
                  style={{
                    width: "100%",
                    height: "100%",
                    textAlign: "left",
                    padding: step.kind === "terminal" ? "0 6px" : "0 12px",
                    boxSizing: "border-box",
                    overflow: "hidden",
                    cursor: "pointer",
                    color: token.colorText,
                    background: chosen
                      ? token.colorPrimaryBg
                      : step.kind === "terminal"
                        ? token.colorFillTertiary
                        : token.colorBgContainer,
                    borderRadius: step.kind === "terminal" ? 24 : token.borderRadius,
                    border: `1px ${step.kind === "human" ? "dashed" : "solid"} ${chosen ? token.colorPrimary : token.colorBorder}`,
                  }}
                >
                  <strong
                    style={{
                      display: "block",
                      fontSize: step.kind === "terminal" ? 11 : 13,
                      fontWeight: step.kind === "terminal" ? 400 : 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {step.title}
                  </strong>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: token.colorTextSecondary,
                    }}
                  >
                    {step.detail ?? step.executor}
                  </span>
                  {attachments && box.height >= 74 && (
                    <span
                      style={{ display: "block", fontSize: 10, color: token.colorTextSecondary }}
                    >
                      {attachments}
                    </span>
                  )}
                </button>
                {retry && (
                  <button
                    type="button"
                    data-loop={step.id}
                    aria-label={`${retry.label ?? "Retry"}: ${retry.maxTraversals ?? step.maxAttempts ?? "unlimited"}`}
                    title={retry.label}
                    onClick={() => choose({ kind: "step", id: step.id })}
                    style={{
                      position: "absolute",
                      left: box.width + (box.width < 190 ? 2 : 14),
                      top: box.height / 2 - 9,
                      borderRadius: 12,
                      border: 0,
                      background: token.cyan,
                      color: token.colorWhite,
                      cursor: "pointer",
                      minWidth: 18,
                      height: 18,
                      padding: 0,
                      fontSize: 11,
                    }}
                  >
                    {retry.maxTraversals ?? step.maxAttempts ?? "↻"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {showDetails && (
        <div style={{ marginTop: 16 }} aria-live="polite">
          <Typography.Title level={5}>{node?.title ?? graph.title}</Typography.Title>
          <Typography.Paragraph>{node?.description ?? graph.description}</Typography.Paragraph>
          {node ? (
            <>
              {node.models?.map((model) => (
                <Tag key={model}>{model}</Tag>
              ))}
              {node.maxAttempts !== undefined && <Tag>Attempts: {node.maxAttempts}</Tag>}
              {node.policies?.map((policy) => (
                <Tag key={policy}>Policy: {policy}</Tag>
              ))}
              {(["skills", "guards"] as const).map((kind) =>
                node[kind]?.length ? (
                  <div key={kind}>
                    <Typography.Text strong>
                      {kind === "skills" ? "Skills" : "Guards"}
                    </Typography.Text>
                    <ul>
                      {node[kind]!.map((item) => (
                        <li key={item.id}>
                          {item.label}
                          {item.enabled === false ? " (disabled)" : ""}
                          {item.description ? ` — ${item.description}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </>
          ) : (
            graph.maxTotalAttempts !== undefined && (
              <Tag>Total attempts: {graph.maxTotalAttempts}</Tag>
            )
          )}
        </div>
      )}
    </section>
  );
}
