import type { AgentDefinition as AgentDefinitionDto } from "./types";
import { useCallback, useEffect, useState } from "react";
import type { AgentSettings } from "./types";
import type { AgentSettingsApi } from "./types";

import type { AgentSettingsStore, AgentDefinitionsStore, SettingsNotice as Notice } from "./types";
const merged = (
  saved: Partial<AgentSettings>,
  defaultAgentSettings: AgentSettings,
): AgentSettings => ({
  ...defaultAgentSettings,
  ...saved,
  limits: { ...defaultAgentSettings.limits, ...saved.limits },
  models: { ...defaultAgentSettings.models, ...saved.models },
});

/** One draft and revision per panel, so every view shows and saves the same settings. */
export function useAgentSettings(
  api: AgentSettingsApi,
  defaults: AgentSettings,
): AgentSettingsStore {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    void api
      .settings()
      .then((stored) => {
        const loaded = merged(stored.settings as Partial<AgentSettings>, defaults);
        setSettings(loaded);
        setSaved(loaded);
        setRevision(stored.revision);
      })
      .catch((error: Error) => setNotice({ type: "error", text: error.message }));
  }, [api, defaults]);

  return {
    settings,
    notice,
    dirty: JSON.stringify(settings) !== JSON.stringify(saved),
    update: (next) => {
      setSettings(next);
      setNotice(null);
    },
    save: async () => {
      try {
        const stored = await api.saveSettings(settings!, revision);
        setSaved(settings);
        setRevision(stored.revision);
        setNotice({ type: "success", text: "Saved. New runs use these settings." });
      } catch (error) {
        setNotice({ type: "error", text: (error as Error).message });
      }
    },
  };
}

/** Skills and guards, shared so a change made in one view reaches the others. */
export function useAgentDefinitions(api: AgentSettingsApi): AgentDefinitionsStore {
  const [items, setItems] = useState<readonly AgentDefinitionDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.definitions().then(setItems, (failure: Error) => setError(failure.message));
  }, [api]);

  const change = useCallback(
    async (work: () => Promise<unknown>) => {
      setError(null);
      try {
        await work();
      } catch (failure) {
        setError((failure as Error).message);
      }
      await api.definitions().then(setItems, (failure: Error) => setError(failure.message));
    },
    [api],
  );
  return { items, error, change };
}
