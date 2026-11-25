import { readFileSync } from "node:fs";
import type { ICapability } from "./Capability";
import { AnalyzeCapability } from "./AnalyzeCapability";
import { GapsCapability } from "./GapsCapability";

/** Every capability the assistant offers, by id and by slash command. */
export class CapabilityRegistry {
  private readonly byId = new Map<string, ICapability>();
  private readonly byCommand = new Map<string, ICapability>();

  constructor(
    capabilities: readonly ICapability[],
    /** Used when the router cannot decide; it must handle any request. */
    readonly fallbackId: string,
    /** Used when the router abstains because the request is unclear. */
    readonly unclearId: string,
  ) {
    for (const capability of capabilities) {
      if (this.byId.has(capability.id) || this.byCommand.has(capability.command))
        throw new Error(`Duplicate capability: ${capability.id}`);
      this.byId.set(capability.id, capability);
      this.byCommand.set(capability.command, capability);
    }
    this.get(fallbackId);
    this.get(unclearId);
  }

  static default(): CapabilityRegistry {
    const registry = new CapabilityRegistry(
      [new AnalyzeCapability(), new GapsCapability()],
      "gaps",
      "gaps",
    );
    registry.assertMatchesManifest(manifestCommands());
    return registry;
  }

  /**
   * The chat offers the commands listed in kushex-plugin.json (the panel never runs plugin code to
   * learn them). Fail loudly when a capability was added or renamed without updating that list.
   */
  assertMatchesManifest(declared: readonly string[]): void {
    const actual = this.all().map((capability) => capability.command);
    const missing = actual.filter((command) => !declared.includes(command));
    const unknown = declared.filter((command) => !actual.includes(command));
    if (missing.length || unknown.length)
      throw new Error(
        `kushex-plugin.json "commands" is out of date.${missing.length ? ` Add: ${missing.join(", ")}.` : ""}${
          unknown.length ? ` Remove: ${unknown.join(", ")}.` : ""
        } Then restart Cognition Panel.`,
      );
  }

  all(): ICapability[] {
    return [...this.byId.values()];
  }

  get(id: string): ICapability {
    const capability = this.byId.get(id);
    if (!capability) throw new Error(`Unknown capability: ${id}`);
    return capability;
  }

  command(command: string): ICapability | undefined {
    return this.byCommand.get(command.toLowerCase());
  }
}

const AGENT_ID = "research";

/** The command names this agent declares in its plugin manifest. */
function manifestCommands(): string[] {
  const manifest = JSON.parse(readFileSync(new URL("../../kushex-plugin.json", import.meta.url), "utf8")) as {
    agents?: Array<{ id?: string; commands?: Array<{ name?: string }> }>;
  };
  const agent = manifest.agents?.find((entry) => entry.id === AGENT_ID);
  return (agent?.commands ?? []).map((command) => String(command.name));
}
