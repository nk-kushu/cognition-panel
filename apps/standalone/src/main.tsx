import "@kushex/ui/preflight.css";
import "@kushex/ui/style.css";
import { KushexPanel, type AgentUiPlugin } from "@kushex/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

if (import.meta.env.DEV) {
  const { default: setupLocatorUI } = await import("@locator/runtime");
  setupLocatorUI({
    adapter: "jsx",
    ...(import.meta.env.VITE_LOCATOR_PROJECT_PATH
      ? { projectPath: import.meta.env.VITE_LOCATOR_PROJECT_PATH }
      : {}),
  });
}

// Frontend contributions are compiled with the host and share its React runtime.
const pluginModules = import.meta.glob<{ default: AgentUiPlugin }>("../../../plugins/*/ui.tsx", {
  eager: true,
});
const agentUiPlugins = Object.values(pluginModules).map((module) => module.default);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KushexPanel
      agentUiPlugins={agentUiPlugins}
      instanceId="standalone"
      router="browser"
      style={{ height: "100%" }}
    />
  </StrictMode>,
);
