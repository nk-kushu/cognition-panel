import type { CognitionClient } from "./CognitionClient";

type LocalApp = Readonly<{ id: string; name: string; appDir: string }>;

/** Path segments shared at the end; the panel and cognition mount the same checkout under different roots. */
function sharedTail(a: string, b: string): number {
  const left = a.split("/").filter(Boolean);
  const right = b.split("/").filter(Boolean);
  let count = 0;
  while (count < left.length && count < right.length && left[left.length - 1 - count] === right[right.length - 1 - count]) count += 1;
  return count;
}

/** Below this, a match is only the folder name, which many checkouts share. */
const MIN_SHARED_SEGMENTS = 2;

/**
 * The cognition app this run works on: `configuration.appId` when cognition started the run,
 * otherwise the app whose directory is the chat project's workspace.
 */
export async function resolveAppId(
  configuration: Readonly<Record<string, unknown>>,
  workspace: string,
  client: Pick<CognitionClient, "get">,
): Promise<{ appId: string; appName: string }> {
  if (typeof configuration.appId === "string" && configuration.appId.trim()) {
    const appId = configuration.appId.trim();
    return { appId, appName: typeof configuration.appName === "string" ? configuration.appName : appId };
  }
  const apps = await client.get<LocalApp[]>("/local-apps");
  let best: LocalApp | null = null;
  let bestScore = 0;
  for (const app of apps) {
    const score = sharedTail(app.appDir, workspace);
    if (score > bestScore) {
      best = app;
      bestScore = score;
    }
  }
  if (!best || bestScore < MIN_SHARED_SEGMENTS)
    throw new Error(`I cannot find a cognition app for this project (${workspace}). Open the chat from an app in cognition, or start the run with configuration.appId.`);
  return { appId: best.id, appName: best.name };
}
