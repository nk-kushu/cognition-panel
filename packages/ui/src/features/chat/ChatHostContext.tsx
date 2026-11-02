import { Button, type ButtonProps } from "antd";
import { createContext, useContext } from "react";
import { useNavigate } from "react-router";

export const ChatHostContext = createContext<
  Readonly<{
    cognitionPanelUrl?: string;
    pauseOnEntry?: boolean;
  }>
>({});

/** Links stay inside Cognition, or open the same runtime's standalone panel from a host. */
export function PanelLink({
  path,
  internalPath,
  ...props
}: ButtonProps & { path: string; internalPath?: string }) {
  const { cognitionPanelUrl } = useContext(ChatHostContext);
  const navigate = useNavigate();
  if (cognitionPanelUrl) {
    const base = new URL(cognitionPanelUrl, globalThis.location.href);
    if (!["http:", "https:"].includes(base.protocol))
      throw new Error("Use an HTTP Cognition Panel URL.");
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
    base.search = "";
    base.hash = "";
    return <Button {...props} href={base.href} target="_blank" rel="noopener noreferrer" />;
  }
  return <Button {...props} onClick={() => void navigate(internalPath ?? path)} />;
}
