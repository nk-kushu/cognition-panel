/** What a source answers; each category has its own tool and its own evidence weight. */
export type Category = "keywords" | "web" | "ads" | "community" | "reviews" | "pages";

/** One piece of raw material a provider returned. `text` is kept verbatim so quotes can be checked later. */
export type SourceItem = Readonly<{
  title: string;
  url?: string;
  text: string;
  provider: string;
  category: Category;
}>;

/** The normalized question every tool asks of its providers; a provider reads only what it needs. */
export type ProviderRequest = Readonly<{
  query?: string;
  keywords?: readonly string[];
  /** A competitor domain, an app id or a page URL, depending on the provider. */
  target?: string;
  /** Upper bound on the items returned. */
  limit: number;
  /** ISO 3166 alpha-2, e.g. "US". */
  country: string;
  /** ISO 639-1, e.g. "en". */
  language: string;
  /** Reviews only: keep reviews rated at or below this (complaints). */
  maxRating?: number;
}>;

export interface ISourceProvider {
  /** Stable id the model can name in `source`, e.g. "tavily". */
  readonly id: string;
  readonly category: Category;
  /** The setting that is missing (an environment variable), or null when the provider is ready. */
  missing(): string | null;
  fetch(request: ProviderRequest): Promise<SourceItem[]>;
}

/** The environment a run reads its keys from (process.env in production). */
export type Env = Readonly<Record<string, string | undefined>>;

/** How strongly cognition weighs a document: people's own words count most. */
export type EvidenceKind = "real_user_quote" | "competitor_data";

export function evidenceKindOf(category: Category): EvidenceKind {
  return category === "community" || category === "reviews" ? "real_user_quote" : "competitor_data";
}
