import type { Icon } from "@tabler/icons-react";
import {
  AgentRunIcon,
  ArtifactIcon,
  ContextIcon,
  MemoryIcon,
  DebugEventsIcon,
  ExecutorIcon,
  MindUnitIcon,
  ModelCallIcon,
  OperationIcon,
  ToolCallIcon,
  TurnIcon,
  WorkflowStepIcon,
} from "./internal/icons";
import type { SpanKind, Tone } from "./debugTrace";

/** Icon, accent text, soft chip and timeline bar colors per span kind. */
export const KIND_STYLES: Readonly<
  Record<SpanKind, Readonly<{ icon: Icon; text: string; chip: string; bar: string }>>
> = {
  root: {
    icon: DebugEventsIcon,
    text: "kxd:text-text-muted",
    chip: "kxd:bg-fill",
    bar: "kxd:bg-text-muted",
  },
  run: {
    icon: AgentRunIcon,
    text: "kxd:text-[#3178c6]",
    chip: "kxd:bg-[#3178c6]/12",
    bar: "kxd:bg-[#3178c6]",
  },
  step: {
    icon: WorkflowStepIcon,
    text: "kxd:text-[#9b6cc4]",
    chip: "kxd:bg-[#9b6cc4]/12",
    bar: "kxd:bg-[#9b6cc4]",
  },
  executor: {
    icon: ExecutorIcon,
    text: "kxd:text-[#cb8a00]",
    chip: "kxd:bg-[#cb8a00]/12",
    bar: "kxd:bg-[#cb8a00]",
  },
  mind: {
    icon: MindUnitIcon,
    text: "kxd:text-[#2f9e5b]",
    chip: "kxd:bg-[#2f9e5b]/12",
    bar: "kxd:bg-[#2f9e5b]",
  },
  turn: {
    icon: TurnIcon,
    text: "kxd:text-text-muted",
    chip: "kxd:bg-fill",
    bar: "kxd:bg-text-muted",
  },
  model: {
    icon: ModelCallIcon,
    text: "kxd:text-[#4f8fc0]",
    chip: "kxd:bg-[#4f8fc0]/12",
    bar: "kxd:bg-[#4f8fc0]",
  },
  tool: {
    icon: ToolCallIcon,
    text: "kxd:text-[#d9734f]",
    chip: "kxd:bg-[#d9734f]/12",
    bar: "kxd:bg-[#d9734f]",
  },
  context: {
    icon: ContextIcon,
    text: "kxd:text-[#7c6fd6]",
    chip: "kxd:bg-[#7c6fd6]/12",
    bar: "kxd:bg-[#7c6fd6]",
  },
  memory: {
    icon: MemoryIcon,
    text: "kxd:text-[#2f9e5b]",
    chip: "kxd:bg-[#2f9e5b]/12",
    bar: "kxd:bg-[#2f9e5b]",
  },
  artifact: {
    icon: ArtifactIcon,
    text: "kxd:text-[#0f8f90]",
    chip: "kxd:bg-[#0f8f90]/12",
    bar: "kxd:bg-[#0f8f90]",
  },
  other: {
    icon: OperationIcon,
    text: "kxd:text-text-muted",
    chip: "kxd:bg-fill",
    bar: "kxd:bg-text-muted",
  },
};

/** antd Tag colors per tone. */
export const TONE_TAGS: Readonly<Record<Tone, string | undefined>> = {
  default: undefined,
  primary: "processing",
  success: "success",
  warning: "warning",
  error: "error",
};

/** Dot colors per tone, for event lines. */
export const TONE_DOTS: Readonly<Record<Tone, string>> = {
  default: "kxd:bg-border",
  primary: "kxd:bg-primary",
  success: "kxd:bg-success",
  warning: "kxd:bg-warning",
  error: "kxd:bg-error",
};
