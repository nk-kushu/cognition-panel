import { ToolUseError } from "../../ToolBox";
import type { Http } from "../Http";
import { ProviderError, waitFor } from "../Http";
import type { Env, ISourceProvider, ProviderRequest, SourceItem } from "../types";

const API = "https://api.dataforseo.com/v3";
const LOCATIONS: Readonly<Record<string, string>> = {
  US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "Netherlands",
  BG: "Bulgaria", CA: "Canada", AU: "Australia", PL: "Poland", RO: "Romania", GR: "Greece", AT: "Austria", BE: "Belgium",
  SE: "Sweden", IE: "Ireland", PT: "Portugal", DK: "Denmark", FI: "Finland", NO: "Norway", CH: "Switzerland",
};

export function locationName(country: string): string {
  const name = LOCATIONS[country.toUpperCase()];
  if (!name) throw new ToolUseError(`Unsupported country ${country}. Use one of: ${Object.keys(LOCATIONS).join(", ")}.`);
  return name;
}

type Task<R> = { status_code: number; status_message?: string; result?: R[] | null };
type Envelope<R> = { status_code?: number; status_message?: string; tasks?: Array<Task<R>> };

/** One DataForSEO account (login + password) shared by the four providers that use it. */
export class DataForSeo {
  constructor(
    private readonly env: Env,
    private readonly http: Http,
    private readonly signal: AbortSignal,
    private readonly wait: (ms: number) => Promise<void> = (ms) => waitFor(ms, signal),
  ) {}

  missing(): string | null {
    return this.env.DATAFORSEO_LOGIN?.trim() && this.env.DATAFORSEO_PASSWORD?.trim() ? null : "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD";
  }

  /** A live endpoint: one POST, the answer comes back at once. */
  async live<R>(path: string, body: unknown): Promise<R[]> {
    const task = await this.call<R>("POST", path, body);
    if (task.status_code !== 20000) throw new ProviderError(`DataForSEO: ${task.status_message ?? `status ${task.status_code}`}.`);
    return task.result ?? [];
  }

  /** A task endpoint: post, then poll `task_get` until the result is ready (about a minute at most). */
  async queued<R>(postPath: string, getPath: (id: string) => string, body: unknown): Promise<R[]> {
    const posted = await this.call<unknown>("POST", postPath, body);
    const id = posted.id;
    // task_post answers 20100 ("Task Created"), which is success for a queued task.
    if (!id || (posted.status_code !== 20100 && posted.status_code !== 20000)) throw new ProviderError(`DataForSEO: ${posted.status_message ?? "the task was not created"}.`);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await this.wait(attempt === 0 ? 3_000 : 5_000);
      const task = await this.call<R>("GET", getPath(id));
      if (task.status_code === 20000) return task.result ?? [];
      // 40601 handed over, 40602 in the queue: not ready yet.
      if (task.status_code !== 40601 && task.status_code !== 40602) throw new ProviderError(`DataForSEO: ${task.status_message ?? `status ${task.status_code}`}.`);
    }
    throw new ProviderError("DataForSEO did not finish the task in time; try again later.");
  }

  private async call<R>(method: "GET" | "POST", path: string, body?: unknown): Promise<Task<R> & { id?: string }> {
    const auth = Buffer.from(`${this.env.DATAFORSEO_LOGIN}:${this.env.DATAFORSEO_PASSWORD}`).toString("base64");
    const response = await this.http.json<Envelope<R> & { tasks?: Array<Task<R> & { id?: string }> }>("DataForSEO", `${API}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, 60_000);
    const task = response.tasks?.[0];
    if (!task) throw new ProviderError(`DataForSEO: ${response.status_message ?? "no task in the answer"}.`);
    return task;
  }
}

/** Monthly search volume, CPC and competition for up to 5 keywords (Google Ads data). */
export class DataForSeoKeywordVolume implements ISourceProvider {
  readonly id = "dataforseo-volume";
  readonly category = "keywords" as const;
  constructor(private readonly api: DataForSeo) {}
  missing = () => this.api.missing();

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const keywords = (request.keywords ?? []).slice(0, 5);
    if (!keywords.length) throw new ToolUseError("keywords is required (1–5 keywords).");
    const rows = await this.api.live<{
      keyword: string; search_volume: number | null; competition: string | null; cpc: number | null;
      low_top_of_page_bid?: number | null; high_top_of_page_bid?: number | null;
      monthly_searches?: Array<{ year: number; month: number; search_volume: number | null }> | null;
    }>("/keywords_data/google_ads/search_volume/live", [
      { keywords, location_name: locationName(request.country), language_code: request.language },
    ]);
    return rows.map((row) => {
      const months = (row.monthly_searches ?? []).slice(0, 12).reverse().map((month) => `${month.year}-${String(month.month).padStart(2, "0")}: ${month.search_volume ?? 0}`);
      return {
        title: `Search demand: ${row.keyword}`,
        text: [
          `Keyword: ${row.keyword}`,
          `Market: ${locationName(request.country)}, language ${request.language}`,
          `Monthly searches (average): ${row.search_volume ?? "unknown"}`,
          `Competition among advertisers: ${row.competition ?? "unknown"}`,
          `Cost per click: ${row.cpc ?? "unknown"} USD` + (row.low_top_of_page_bid != null ? ` (top-of-page bid ${row.low_top_of_page_bid}–${row.high_top_of_page_bid ?? "?"} USD)` : ""),
          ...(months.length ? [`Last months: ${months.join(", ")}`] : []),
        ].join("\n"),
        provider: this.id,
        category: this.category,
      };
    });
  }
}

/** Direction of interest over the last 12 months for up to 5 keywords. */
export class GoogleTrends implements ISourceProvider {
  readonly id = "google-trends";
  readonly category = "keywords" as const;
  constructor(private readonly api: DataForSeo) {}
  missing = () => this.api.missing();

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const keywords = (request.keywords ?? []).slice(0, 5);
    if (!keywords.length) throw new ToolUseError("keywords is required (1–5 keywords).");
    const results = await this.api.live<{
      items?: Array<{ type: string; keywords?: string[]; data?: Array<{ date_from?: string; values?: Array<number | null> }> }>;
    }>("/keywords_data/google_trends/explore/live", [
      { keywords, location_name: locationName(request.country), language_code: request.language, time_range: "past_12_months" },
    ]);
    const graph = results[0]?.items?.find((item) => item.type === "google_trends_graph");
    const points = graph?.data ?? [];
    if (!graph || points.length < 4) return [];
    return keywords.map((keyword, index) => {
      const series = points.map((point) => point.values?.[index] ?? 0);
      const quarter = Math.max(1, Math.floor(series.length / 4));
      const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const early = average(series.slice(0, quarter));
      const late = average(series.slice(-quarter));
      const peak = Math.max(...series);
      const direction = late > early * 1.15 ? "rising" : late < early * 0.85 ? "falling" : "flat";
      return {
        title: `Google Trends: ${keyword}`,
        text: [
          `Keyword: ${keyword}`,
          `Market: ${locationName(request.country)}, past 12 months (index 0–100, relative to the keywords' own peak)`,
          `Direction: ${direction} (first quarter average ${early.toFixed(0)}, last quarter average ${late.toFixed(0)}, peak ${peak})`,
        ].join("\n"),
        provider: this.id,
        category: this.category,
      };
    });
  }
}

/** Ads a competitor runs on Google (search, YouTube, Play, ...), from the Ads Transparency Center. */
export class GoogleAdsTransparency implements ISourceProvider {
  readonly id = "google-ads";
  readonly category = "ads" as const;
  constructor(private readonly api: DataForSeo) {}
  missing = () => this.api.missing();

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const target = request.target?.trim();
    if (!target) throw new ToolUseError("google-ads needs domain (a competitor domain such as example.com).");
    const results = await this.api.live<{
      items?: Array<{ title?: string; format?: string; verified?: boolean; first_shown?: string; last_shown?: string; preview_url?: string; url?: string }>;
    }>("/serp/google/ads_search/live/advanced", [{ target, location_name: locationName(request.country), platform: "all" }]);
    return (results[0]?.items ?? []).slice(0, request.limit).map((ad) => ({
      title: `Google ad by ${ad.title ?? target}`,
      ...(ad.url ? { url: ad.url } : {}),
      text: [
        `Advertiser: ${ad.title ?? "unknown"}${ad.verified ? " (verified)" : ""}`,
        `Format: ${ad.format ?? "unknown"}`,
        `First shown: ${ad.first_shown ?? "unknown"}; last shown: ${ad.last_shown ?? "unknown"}`,
        ...(ad.preview_url ? [`Preview: ${ad.preview_url}`] : []),
      ].join("\n"),
      provider: this.id,
      category: this.category,
    }));
  }
}

type Review = { review_text?: string | null; title?: string | null; rating?: { value?: number | null } | null; user_profile?: { profile_name?: string | null } | null; timestamp?: string | null };

/** User reviews of a mobile app from Google Play or the App Store; `target` is the store's app id. */
export class AppStoreReviews implements ISourceProvider {
  readonly category = "reviews" as const;
  constructor(
    private readonly api: DataForSeo,
    readonly id: "google-play" | "app-store",
  ) {}
  missing = () => this.api.missing();

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const appId = request.target?.trim();
    if (!appId) throw new ToolUseError(`${this.id} needs target: the app id (Google Play: the id= part of the URL; App Store: the number after /id).`);
    const store = this.id === "google-play" ? "google" : "apple";
    const results = await this.api.queued<{ items?: Review[] }>(
      `/app_data/${store}/app_reviews/task_post`,
      (taskId) => `/app_data/${store}/app_reviews/task_get/${taskId}`,
      [{ app_id: appId, location_name: locationName(request.country), language_code: request.language, depth: 150 }],
    );
    const reviews = (results[0]?.items ?? []).filter((review) => review.review_text?.trim());
    const wanted = request.maxRating === undefined ? reviews : reviews.filter((review) => (review.rating?.value ?? 5) <= request.maxRating!);
    return wanted.slice(0, request.limit).map((review) => ({
      title: `${this.id === "google-play" ? "Google Play" : "App Store"} review (${review.rating?.value ?? "?"}★)`,
      text: [review.title?.trim(), review.review_text?.trim()].filter(Boolean).join("\n") + `\n— ${review.user_profile?.profile_name ?? "anonymous"}, ${review.timestamp ?? "date unknown"}`,
      provider: this.id,
      category: this.category,
    }));
  }
}
