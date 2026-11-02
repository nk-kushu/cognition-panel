import { useEffect, useId, useRef, useState } from "react";

// Mermaid uses shared rendering state; serialize diagrams, including edits and unmounts.
let rendering = Promise.resolve();

export function MermaidDiagram({ source }: Readonly<{ source: string }>) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const container = useRef<HTMLDivElement>(null);
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

  return (
    <div className="kx-mermaid">
      <div ref={container} role="img" aria-label="Mermaid diagram" hidden={!!error} />
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
