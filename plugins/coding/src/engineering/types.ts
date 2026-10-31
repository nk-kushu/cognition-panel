export type SelectionMode = "auto" | "required" | "off";
export type CodingEngineeringDefinition = Readonly<{
  id: string;
  label: string;
  description: string;
  reviewInstructions: string;
  advisory: boolean;
  guardMode: SelectionMode;
  skillMode: SelectionMode;
  skillInstructions: string;
  skillQuestion: string;
  guardQuestion: string;
}>;
export type CodingEngineeringSettings = Readonly<{
  enabled: boolean;
  maxFixCycles: number;
  definitions: readonly CodingEngineeringDefinition[];
}>;
