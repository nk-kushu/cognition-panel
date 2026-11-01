import { createContext, useContext, useState } from "react";

type RequestMode = Readonly<{ mode: string; change(mode: string): void }>;
export const RequestModeContext = createContext<RequestMode | null>(null);
export function useRequestMode(): RequestMode {
  const hosted = useContext(RequestModeContext);
  const [mode, change] = useState("");
  return hosted ?? { mode, change };
}
