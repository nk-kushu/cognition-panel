import type { WorkflowGraph } from "./types";

export type NodeBox = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Derives positions from forward edges. Return/retry edges never change execution ranks. */
export class WorkflowLayout {
  readonly boxes = new Map<string, NodeBox>();
  readonly width: number;
  readonly height: number;
  readonly errors: readonly string[];
  private readonly rails: readonly string[];

  constructor(readonly graph: WorkflowGraph) {
    const ids = new Set(graph.nodes.map((node) => node.id));
    const errors: string[] = [];
    if (ids.size !== graph.nodes.length) errors.push("Step IDs must be unique.");
    if (new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length)
      errors.push("Transition IDs must be unique.");
    for (const edge of graph.edges) {
      if (!ids.has(edge.fromStepId) || !ids.has(edge.toStepId))
        errors.push(`Transition ${edge.id} references a missing step.`);
    }
    const ranks = new Map(graph.nodes.map((node) => [node.id, 0]));
    const forward = graph.edges.filter(
      (edge) => !edge.kind || edge.kind === "forward" || edge.kind === "stop",
    );
    // Bounded relaxation detects accidental forward cycles instead of hanging the browser.
    for (let pass = 0; pass < graph.nodes.length; pass++) {
      let changed = false;
      for (const edge of forward) {
        if (!ids.has(edge.fromStepId) || !ids.has(edge.toStepId)) continue;
        const rank = ranks.get(edge.fromStepId)! + 1;
        if (rank > ranks.get(edge.toStepId)!) {
          ranks.set(edge.toStepId, rank);
          changed = true;
        }
      }
      if (!changed) break;
      if (pass === graph.nodes.length - 1)
        errors.push("Forward transitions contain a cycle. Mark loops as retry or return.");
    }
    const lanes = graph.lanes ?? [];
    const ranksInOrder = [...new Set(ranks.values())].sort((a, b) => a - b);
    let row = 0;
    for (const rank of ranksInOrder) {
      const rankNodes = graph.nodes.filter((item) => ranks.get(item.id) === rank);
      const occupied = new Map<number, number>();
      let rows = 1;
      let unassigned = 0;
      for (const node of rankNodes) {
        const lane = lanes.findIndex((item) => item.id === node.lane);
        const column = lane >= 0 ? lane : lanes.length + unassigned++;
        const offset = occupied.get(column) ?? 0;
        occupied.set(column, offset + 1);
        rows = Math.max(rows, offset + 1);
        const x =
          lane < 0 && lanes.length && rankNodes.length === 1
            ? Math.max(0, (lanes.length - 1) * 140)
            : column * 280;
        this.boxes.set(node.id, { x, y: 32 + (row + offset) * 112, width: 230, height: 82 });
      }
      row += rows;
    }
    this.rails = [
      ...new Set(
        graph.edges
          .filter((edge) => edge.kind === "return" || edge.kind === "stop")
          .map((edge) => edge.controlId ?? edge.toStepId),
      ),
    ];
    for (const [id, box] of Object.entries(graph.presentation?.nodes ?? {})) {
      if (!ids.has(id)) errors.push(`Layout references a missing step: ${id}.`);
      if (
        ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
        box.x < 0 ||
        box.y < 0 ||
        box.width <= 0 ||
        box.height <= 0
      )
        errors.push(`Invalid layout for step: ${id}.`);
      this.boxes.set(id, box);
    }
    const points = Object.values(graph.presentation?.edges ?? {}).flat();
    const right = Math.max(230, ...[...this.boxes.values()].map((box) => box.x + box.width));
    this.width = graph.presentation
      ? Math.max(right, ...points.map((point) => point.x)) + 4
      : right + 70 + this.rails.length * 24;
    this.height = Math.max(
      140,
      ...[...this.boxes.values()].map((box) => box.y + box.height + 4),
      ...points.map((point) => point.y + 4),
    );
    this.errors = errors;
  }

  path(edgeIndex: number): string {
    const edge = this.graph.edges[edgeIndex]!;
    const points = this.graph.presentation?.edges?.[edge.id];
    if (points?.length)
      return points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join("");
    const from = this.boxes.get(edge.fromStepId)!;
    const to = this.boxes.get(edge.toStepId)!;
    if (edge.kind === "retry" || edge.fromStepId === edge.toStepId) {
      const x = from.x + from.width;
      return `M${x} ${from.y + 20}h30v42h-30`;
    }
    if (edge.kind === "return" || edge.kind === "stop") {
      const rail =
        Math.max(...[...this.boxes.values()].map((box) => box.x + box.width)) +
        24 +
        this.rails.indexOf(edge.controlId ?? edge.toStepId) * 24;
      return `M${from.x + from.width} ${from.y + from.height / 2}H${rail}V${to.y + to.height / 2}H${to.x + to.width}`;
    }
    const x = from.x + from.width / 2;
    const endX = to.x + to.width / 2;
    const y = from.y + from.height;
    const mid = (y + to.y) / 2;
    return `M${x} ${y}V${mid}H${endX}V${to.y}`;
  }
}
