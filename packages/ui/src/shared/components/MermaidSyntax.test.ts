import mermaid from "mermaid";
import { expect, it } from "vitest";

it("accepts workflow diagrams with branches and return loops", async () => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  const diagrams = [
    "flowchart TD\n    U[Start workflow with user request] --> M[Step 0: Choose request mode using JEV DecisionUnit or explicit user choice]\n    M -->|Answer only| Q[Read-only answer branch below]\n    M -->|Change code| A\n    M -->|Needs clarification| CL{Clarification and total limits allow return?}\n    CL -->|Yes| CW[Ask user and persist waiting state]\n    CW -->|Answer received: max 2 returns| M\n    CL -->|Limit reached| S\n    A[Plan investigation] --> B[Investigate]\n    B --> BC{Investigation complete?}\n    BC -->|Need more evidence| L{Loop limits allow another attempt?}\n    BC -->|Yes| C[Plan implementation]\n    C --> CC{Plan ready?}\n    CC -->|Missing information| L\n    CC -->|Yes| D[Write tests]\n    D --> E[Create skeleton]\n    E --> F[Human review]\n    F -->|Request changes| L\n    F -->|Approve| G[Implement]\n    G --> H[Run guards]\n    H -->|Code defect| L\n    H -->|Pass| I[Run tests]\n    I -->|Code defect| L\n    I -->|Pass| J[Complete]\n    D -.->|Missing information or unclear design| L\n    E -.->|Missing information or unclear design| L\n    G -.->|Missing information or unclear design| L\n    H -.->|Evidence or design problem| L\n    I -.->|Evidence or design problem| L\n    L -->|Within category and total limits| R[Choose the next step]\n    L -->|Limit reached or no progress| S[Stop and report unresolved work]\n    R -->|More investigation: max 3 returns| B\n    R -->|Revise plan: max 2 returns| C\n    R -->|Revise skeleton: max 3 returns| E\n    R -->|Fix code: max 3 returns shared by guards and tests| G\n    T[All loops combined: max 8 returns per run] -.-> L\n",
    "flowchart TD\n    A[Load relevant context and project memory] --> B{Enough evidence to answer?}\n    B -->|Yes| C[Write answer with source references]\n    B -->|No| D{Investigation allowance remains?}\n    D -->|Yes: at most 3 rounds total| E[Find candidate files \u2192 JEV selection \u2192 read]\n    E --> B\n    D -->|Limit reached or no progress| F[Explain what is known and what remains unclear]\n",
  ];
  for (const source of diagrams) expect(await mermaid.parse(source)).toBeTruthy();
});

it("renders a real SVG diagram with the installed Mermaid runtime", async () => {
  // jsdom supplies no SVG text geometry; browser layout provides these in the app.
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 80, height: 20 }),
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value: () => 80,
  });
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });
  const container = document.createElement("div");
  document.body.appendChild(container);
  try {
    const { svg } = await mermaid.render(
      "real-diagram-test",
      "flowchart TD\nStart --> Finish",
      container,
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("Start");
    expect(svg).toContain("Finish");
  } finally {
    container.remove();
  }
});
