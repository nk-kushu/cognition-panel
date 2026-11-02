import type { RecordedDebugEventDto } from "./types";
import { Button, Modal, Tooltip } from "antd";
import { useState } from "react";
import { AppIcon } from "./internal/AppIcon";
import { FullscreenIcon } from "./internal/icons";
import { executionDetails } from "./executionContent";

const labels: Record<string, string> = {
  request: "1 · LLM input — exact request",
  reply: "2 · LLM output — full reply",
  action: "3 · Parsed action",
  "tool-input": "4 · Tool arguments",
  "tool-output": "5 · Tool result",
  notebook: "4 · Notebook — entry and saved state",
  acceptance: "4 · Final result validation",
  observation: "6 · Observation for the next turn",
};
const order = [
  "request",
  "reply",
  "action",
  "tool-input",
  "tool-output",
  "notebook",
  "acceptance",
  "observation",
];

type ExecutionDetail = ReturnType<typeof executionDetails>[number];

function detailLabel(detail: ExecutionDetail): string {
  const label = labels[detail.stage] ?? detail.stage;
  return detail.complete ? label : `${label} · incomplete recording`;
}

function DetailContent({
  detail,
  heightClass,
}: Readonly<{ detail: ExecutionDetail; heightClass: string }>) {
  return (
    <>
      {!detail.complete && (
        <p role="status" className="kxd:text-xs kxd:text-text-muted">
          Some chunks are missing. This is not the complete content.
        </p>
      )}
      <pre
        className={`kxd:m-0 kxd:mt-2 kxd:overflow-auto kxd:font-mono kxd:text-[11px] kxd:break-words kxd:whitespace-pre-wrap ${heightClass}`}
      >
        {detail.text}
      </pre>
    </>
  );
}

/** The visible execution cycle, with readable payloads rather than only size counters. */
export function ExecutionDetails({
  events,
}: Readonly<{ events: readonly RecordedDebugEventDto[] }>) {
  const details = executionDetails(events).sort(
    (a, b) => order.indexOf(a.stage) - order.indexOf(b.stage),
  );
  const [fullscreen, setFullscreen] = useState<ExecutionDetail | null>(null);
  return (
    <section aria-label="Execution content" className="kxd:flex kxd:min-w-0 kxd:flex-col kxd:gap-2">
      <h3 className="kxd:m-0 kxd:text-xs kxd:font-semibold">
        Input → LLM → action → result → next turn
      </h3>
      {details.length === 0 ? (
        <p className="kxd:m-0 kxd:text-xs kxd:text-text-muted">
          Execution content was not recorded for this turn. New runs with the updated KushiBot
          include requests, replies and state changes.
        </p>
      ) : (
        details.map((detail, index) => (
          <div key={`${detail.stage}:${index}`} className="kxd:relative kxd:min-w-0">
            <details className="kxd:rounded kxd:border kxd:border-solid kxd:border-border kxd:bg-surface kxd:p-2">
              <summary className="kxd:cursor-pointer kxd:pr-7 kxd:text-xs kxd:font-medium">
                {detailLabel(detail)}
              </summary>
              <DetailContent detail={detail} heightClass="kxd:max-h-96" />
            </details>
            <Tooltip title="Full screen">
              <Button
                type="text"
                size="small"
                aria-label={`Open ${labels[detail.stage] ?? detail.stage} full screen`}
                icon={<AppIcon icon={FullscreenIcon} size="sm" />}
                className="kxd:absolute! kxd:top-1 kxd:right-1"
                onClick={() => setFullscreen(detail)}
              />
            </Tooltip>
          </div>
        ))
      )}
      <Modal
        open={fullscreen !== null}
        title={fullscreen && detailLabel(fullscreen)}
        onCancel={() => setFullscreen(null)}
        footer={null}
        width="calc(100vw - 32px)"
        style={{ top: 16, maxWidth: "none", paddingBottom: 0 }}
        destroyOnHidden
      >
        {fullscreen && (
          <DetailContent detail={fullscreen} heightClass="kxd:h-[calc(100vh-110px)]" />
        )}
      </Modal>
    </section>
  );
}
