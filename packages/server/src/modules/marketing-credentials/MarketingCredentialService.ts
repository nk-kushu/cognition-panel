import type { PrismaClient } from "../../generated/prisma/client.js";
import type { RequestContext } from "../../shared/application/RequestContext.js";
import { HttpError } from "../../errors/HttpError.js";
import type { SecretCipher } from "../openrouter/SecretCipher.js";

/**
 * The settings the research agents read for their market sources. A name is also the environment
 * variable the agent falls back to, so one list serves both. Anything else is refused: this store is
 * not a general secret vault.
 */
export const MARKETING_CREDENTIAL_NAMES = [
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "META_AD_LIBRARY_TOKEN",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "FIRECRAWL_API_KEY",
] as const;

export type MarketingCredentialName = (typeof MARKETING_CREDENTIAL_NAMES)[number];

export interface MarketingCredentialStatus {
  name: MarketingCredentialName;
  configured: boolean;
  updatedAt: string | null;
}

/** One encrypted value per operator and name, handed to the agents that may use provider keys. */
export class MarketingCredentialService {
  constructor(
    private readonly db: PrismaClient,
    private readonly cipher: SecretCipher,
  ) {}

  async status(context: RequestContext): Promise<{ credentials: MarketingCredentialStatus[] }> {
    const rows = await this.db.marketingCredential.findMany({
      where: { actorId: context.actor.id },
      select: { name: true, updatedAt: true },
    });
    const byName = new Map(rows.map((row) => [row.name, row.updatedAt]));
    return {
      credentials: MARKETING_CREDENTIAL_NAMES.map((name) => ({
        name,
        configured: byName.has(name),
        updatedAt: byName.get(name)?.toISOString() ?? null,
      })),
    };
  }

  async save(context: RequestContext, name: string, value: string) {
    const known = knownName(name);
    const encryptedValue = this.cipher.encrypt(value);
    await this.db.marketingCredential.upsert({
      where: { actorId_name: { actorId: context.actor.id, name: known } },
      create: { actorId: context.actor.id, name: known, encryptedValue },
      update: { encryptedValue },
    });
    return this.status(context);
  }

  async remove(context: RequestContext, name: string) {
    const known = knownName(name);
    await this.db.marketingCredential.deleteMany({ where: { actorId: context.actor.id, name: known } });
    return this.status(context);
  }

  /** Only used for the private runner IPC payload; never a public DTO or pinned setting. */
  async credentials(context: RequestContext): Promise<Record<string, string>> {
    const rows = await this.db.marketingCredential.findMany({ where: { actorId: context.actor.id } });
    const known = new Set<string>(MARKETING_CREDENTIAL_NAMES);
    const values: Record<string, string> = {};
    for (const row of rows) if (known.has(row.name)) values[row.name] = this.cipher.decrypt(row.encryptedValue);
    return values;
  }
}

function knownName(name: string): MarketingCredentialName {
  const found = MARKETING_CREDENTIAL_NAMES.find((candidate) => candidate === name);
  if (!found) throw new HttpError(400, "UNKNOWN_MARKETING_CREDENTIAL", `Unknown setting ${name.slice(0, 80)}.`);
  return found;
}
