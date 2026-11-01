import { OpenRouterModelInput } from "../OpenRouter";
import { InputNumber } from "antd";
import type { AgentSettings } from "./types";
import { useSettingsSchema } from "./SettingsSchemaContext";
import type { AgentSettingsStore } from "./types";

type FieldProps<Key> = Readonly<{
  field: Key;
  settings: AgentSettings;
  update: AgentSettingsStore["update"];
  disabled: boolean;
}>;

export function LimitField({ field, settings, update, disabled }: FieldProps<string>) {
  const { limits: LIMITS } = useSettingsSchema();
  const { label, min, max } = LIMITS.find(({ key }) => key === field)!;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      {label}
      <InputNumber
        aria-label={label}
        disabled={disabled}
        min={min}
        max={max}
        precision={0}
        value={settings.limits[field]}
        onChange={(value) =>
          update({ ...settings, limits: { ...settings.limits, [field]: value ?? min } })
        }
      />
    </div>
  );
}

export function ModelField({ field, settings, update, disabled }: FieldProps<string>) {
  const { models: MODELS, defaultModelKey } = useSettingsSchema();
  const { label } = MODELS.find(({ key }) => key === field)!;
  return (
    <div style={{ display: "block" }}>
      {label}
      <OpenRouterModelInput
        label={`${label} model`}
        disabled={disabled}
        placeholder={field === defaultModelKey ? "Server default" : "Inherit the default"}
        value={settings.models[field] ?? ""}
        onChange={(value) =>
          update({ ...settings, models: { ...settings.models, [field]: value } })
        }
      />
    </div>
  );
}
