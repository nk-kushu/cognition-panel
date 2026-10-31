import { createHash } from "node:crypto";
import { codingEngineeringCatalog } from "./catalog";
import type {
  CodingEngineeringDefinition,
  CodingEngineeringSettings,
  SelectionMode,
} from "./types";

/** Validates user settings once and pins an immutable catalog for this run. */
export class CodingEngineeringConfiguration {
  readonly settings: CodingEngineeringSettings;
  readonly version: string;
  constructor(value: unknown = {}) {
    const input = this.record(value);
    const overrides = this.record(input.overrides ?? {});
    if (
      Object.keys(overrides).some((id) => !codingEngineeringCatalog.some((item) => item.id === id))
    )
      throw new Error("Unknown engineering definition.");
    const enabled = input.enabled ?? true;
    const maxFixCycles = input.maxFixCycles ?? 2;
    if (
      typeof enabled !== "boolean" ||
      !Number.isSafeInteger(maxFixCycles) ||
      (maxFixCycles as number) < 0 ||
      (maxFixCycles as number) > 4
    )
      throw new Error("Invalid engineering controls; fix cycles must be between 0 and 4.");
    if (Object.keys(input).some((key) => !["enabled", "maxFixCycles", "overrides"].includes(key)))
      throw new Error("Unknown engineering setting.");
    const definitions = codingEngineeringCatalog.map((definition) =>
      this.definition(definition, overrides[definition.id]),
    );
    this.settings = Object.freeze({
      enabled,
      maxFixCycles: maxFixCycles as number,
      definitions: Object.freeze(definitions),
    });
    this.version = createHash("sha256")
      .update(JSON.stringify(this.settings))
      .digest("hex")
      .slice(0, 24);
  }
  private definition(base: CodingEngineeringDefinition, raw: unknown): CodingEngineeringDefinition {
    const override = this.record(raw ?? {});
    if (
      Object.keys(override).some(
        (key) =>
          ![
            "guardMode",
            "skillMode",
            "skillInstructions",
            "reviewInstructions",
            "advisory",
          ].includes(key),
      )
    )
      throw new Error(`Unknown override for ${base.id}.`);
    const guardMode = this.mode(override.guardMode ?? base.guardMode);
    const skillMode = this.mode(override.skillMode ?? base.skillMode);
    const skillInstructions = this.text(
      override.skillInstructions ?? base.skillInstructions,
      8192,
      true,
    );
    const reviewInstructions = this.text(
      override.reviewInstructions ?? base.reviewInstructions,
      16_384,
      false,
    );
    const advisory = override.advisory ?? base.advisory;
    if (typeof advisory !== "boolean" || (skillMode !== "off" && !skillInstructions.trim()))
      throw new Error(`Invalid instructions for ${base.id}.`);
    return Object.freeze({
      ...base,
      guardMode,
      skillMode,
      skillInstructions,
      reviewInstructions,
      advisory,
    });
  }
  private mode(raw: unknown): SelectionMode {
    if (raw !== "auto" && raw !== "required" && raw !== "off")
      throw new Error("Invalid selection mode.");
    return raw;
  }
  private text(raw: unknown, max: number, empty: boolean): string {
    if (typeof raw !== "string" || (!empty && !raw.trim()) || Buffer.byteLength(raw) > max)
      throw new Error("Engineering instructions exceed their size limit or are invalid.");
    return raw;
  }
  private record(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Engineering configuration must be an object.");
    return raw as Record<string, unknown>;
  }
}
