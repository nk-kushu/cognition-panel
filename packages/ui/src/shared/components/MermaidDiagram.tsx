import { Button, Modal } from "antd";
import { FullscreenIcon } from "../lib/icons";
import { useEffect, useId, useRef, useState } from "react";

// Mermaid uses shared rendering state; serialize diagrams, including edits and unmounts.
let rendering = Promise.resolve();

export function MermaidDiagram({
  source,
  expanded = false,
}: Readonly<{ source: string; expanded?: boolean }>) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const container = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    rendering = rendering.then(async () => {
      if (cancelled || !container.current) return;
      setError(null);
      try {
        const { default: mermaid } = await import("mermaid");
        if (cancelled || !container.current) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
        });
        const { svg } = await mermaid.render(id, source, container.current);
        if (!cancelled && container.current) container.current.innerHTML = svg;
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [id, source]);

  useEffect(() => {
    const element = viewport.current;
    if (!expanded || !element) return;

    const zoomAt = (factor: number, clientX: number, clientY: number) => {
      if (drag.current || !Number.isFinite(factor) || factor <= 0) return;
      const bounds = element.getBoundingClientRect();
      const x = clientX - bounds.left;
      const y = clientY - bounds.top;
      setView((current) => {
        const scale = Math.min(8, Math.max(0.1, current.scale * factor));
        const ratio = scale / current.scale;
        return { x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio, scale };
      });
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const delta = Math.max(-200, Math.min(200, event.deltaY * unit));
      zoomAt(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)), event.clientX, event.clientY);
    };
    // Safari emits gesture events for trackpad pinches; Chromium/Firefox use Ctrl+wheel.
    let lastGestureScale = 1;
    const gestureStart = (event: Event) => {
      event.preventDefault();
      lastGestureScale = 1;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      zoomAt(gesture.scale / lastGestureScale, gesture.clientX, gesture.clientY);
      lastGestureScale = gesture.scale;
    };
    // A native non-passive listener prevents scrolling or zooming the whole page.
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", gestureStart, { passive: false });
    element.addEventListener("gesturechange", gestureChange, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", gestureStart);
      element.removeEventListener("gesturechange", gestureChange);
    };
  }, [expanded]);

  return (
    <div className={expanded ? "kx-mermaid kx-mermaid-expanded" : "kx-mermaid"}>
      {!expanded && (
        <div className="kx-mermaid-toolbar">
          <Button
            size="small"
            icon={<FullscreenIcon size={16} />}
            aria-label="View Mermaid diagram fullscreen"
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setFullscreen(true);
            }}
          >
            Fullscreen
          </Button>
        </div>
      )}
      {expanded && (
        <div className="kx-mermaid-toolbar kx-mermaid-pan-toolbar">
          <span>Drag to pan · scroll or pinch to zoom · {Math.round(view.scale * 100)}%</span>
          <Button size="small" onClick={() => setView({ x: 0, y: 0, scale: 1 })}>
            Reset view
          </Button>
        </div>
      )}
      <div
        ref={viewport}
        className={expanded ? "kx-mermaid-pan-viewport" : undefined}
        role={expanded ? "region" : undefined}
        aria-label={expanded ? "Pan Mermaid diagram" : undefined}
        onPointerDown={(event) => {
          if (!expanded || event.button !== 0 || drag.current) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            originX: view.x,
            originY: view.y,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.pointerId !== event.pointerId) return;
          setView((current) => ({
            ...current,
            x: start.originX + event.clientX - start.x,
            y: start.originY + event.clientY - start.y,
          }));
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <div
          ref={container}
          role="img"
          aria-label="Mermaid diagram"
          hidden={!!error}
          style={
            expanded
              ? {
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                  transformOrigin: "top left",
                }
              : undefined
          }
        />
      </div>
      {!expanded && (
        <Modal
          title="Mermaid diagram"
          open={fullscreen}
          onCancel={() => setFullscreen(false)}
          footer={null}
          destroyOnHidden
          width="100vw"
          style={{ top: 0, maxWidth: "100vw", margin: 0, paddingBottom: 0 }}
          styles={{
            container: {
              height: "100dvh",
              borderRadius: 0,
              display: "flex",
              flexDirection: "column",
            },
            body: { flex: 1, minHeight: 0, overflow: "hidden" },
          }}
        >
          <MermaidDiagram source={source} expanded />
        </Modal>
      )}
      {error && (
        <>
          <div role="alert">Could not render Mermaid diagram: {error}</div>
          <pre>
            <code>{source}</code>
          </pre>
        </>
      )}
    </div>
  );
}
