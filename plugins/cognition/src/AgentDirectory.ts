import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** An agent the router can hand a message to, as its plugin manifest declares it. */
export type TargetAgent = Readonly<{
  id: string;
  name: string;
  description: string;
  commands: readonly string[];
  /** Absolute path of the agent's entry file (exports `chat`). */
  entry: string;
}>;

type Manifest = Readonly<{
  agents?: ReadonlyArray<{ id?: unknown; name?: unknown; description?: unknown; directory?: unknown; entry?: unknown; commands?: ReadonlyArray<{ name?: unknown }> }>;
}>;

/** Finds each agent id in the manifests of the plugins next to the router. */
export function loadTargets(pluginsDir: string, ids: readonly string[]): TargetAgent[] {
  const found = new Map<string, TargetAgent>();
  for (const folder of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const pluginDir = path.join(pluginsDir, folder.name);
    const manifest = readManifest(path.join(pluginDir, "kushex-plugin.json"));
    for (const agent of manifest?.agents ?? []) {
      if (typeof agent.id !== "string" || !ids.includes(agent.id) || found.has(agent.id)) continue;
      const directory = typeof agent.directory === "string" ? agent.directory : ".";
      const entry = typeof agent.entry === "string" ? agent.entry : "agent.ts";
      found.set(agent.id, {
        id: agent.id,
        name: typeof agent.name === "string" ? agent.name : agent.id,
        description: typeof agent.description === "string" ? agent.description : "",
        commands: (agent.commands ?? []).map((command) => String(command.name ?? "").toLowerCase()).filter(Boolean),
        entry: path.resolve(pluginDir, directory, entry),
      });
    }
  }
  return ids.map((id) => {
    const agent = found.get(id);
    if (!agent) throw new Error(`The router cannot find agent "${id}" in any plugin manifest under ${pluginsDir}. Install it or remove it from TARGET_AGENTS.`);
    return agent;
  });
}

/**
 * The chat only offers the routing agent's own manifest commands, so that list must be exactly the
 * targets' commands, each owned by one agent.
 */
export function assertCommands(targets: readonly TargetAgent[], declared: readonly string[]): void {
  const owners = new Map<string, string>();
  for (const agent of targets)
    for (const command of agent.commands) {
      const owner = owners.get(command);
      if (owner) throw new Error(`Both ${owner} and ${agent.id} declare ${command}; the router cannot tell them apart. Rename one.`);
      owners.set(command, agent.id);
    }
  const actual = [...owners.keys()];
  const wanted = declared.map((command) => command.toLowerCase());
  const missing = actual.filter((command) => !wanted.includes(command));
  const unknown = wanted.filter((command) => !actual.includes(command));
  if (missing.length || unknown.length)
    throw new Error(
      `kushex-plugin.json "commands" of the cognition router is out of date.${missing.length ? ` Add: ${missing.join(", ")}.` : ""}${
        unknown.length ? ` Remove: ${unknown.join(", ")}.` : ""
      } Then restart Cognition Panel.`,
    );
}

/** The command names the router declares in its own manifest. */
export function routerCommands(manifestPath: string): string[] {
  const manifest = readManifest(manifestPath);
  return (manifest?.agents?.find((agent) => agent.id === "cognition")?.commands ?? []).map((command) => String(command.name));
}

function readManifest(file: string): Manifest | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch {
    return null;
  }
}
