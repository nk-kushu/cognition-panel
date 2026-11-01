import { createContext, useContext } from "react";
import type { AgentSettingsSchema } from "./types";
export const SettingsSchemaContext = createContext<AgentSettingsSchema | null>(null);
export function useSettingsSchema(): AgentSettingsSchema {
  const schema = useContext(SettingsSchemaContext);
  if (!schema) throw new Error("Settings editors require AgentSettingsPanel.");
  return schema;
}
