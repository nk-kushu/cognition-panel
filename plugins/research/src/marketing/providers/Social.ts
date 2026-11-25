import { ToolUseError } from "../../ToolBox";
import type { Http } from "../Http";
import { htmlToText, truncate } from "../Text";
import type { Env, ISourceProvider, ProviderRequest, SourceItem } from "../types";

const USER_AGENT = "cognition-research-agent/0.1 (market research)";

function needQuery(request: ProviderRequest): string {
  const query = request.query?.trim();
  if (!query) throw new ToolUseError("query is required.");
  return query;
}

/** Reddit posts, through an app-only OAuth token (REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET). */
export class Reddit implements ISourceProvider {
  readonly id = "reddit";
  readonly category = "community" as const;
  private token: Promise<string> | undefined;
  constructor(private readonly env: Env, private readonly http: Http) {}
  missing = () => (this.env.REDDIT_CLIENT_ID?.trim() && this.env.REDDIT_CLIENT_SECRET?.trim() ? null : "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET");

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const params = new URLSearchParams({ q: needQuery(request), limit: String(Math.min(request.limit, 25)), sort: "relevance", t: "year", type: "link" });
    const response = await this.http.json<{
      data?: { children?: Array<{ data?: { title?: string; selftext?: string; subreddit?: string; author?: string; permalink?: string; score?: number; num_comments?: number } }> };
    }>("Reddit", `https://oauth.reddit.com/search?${params}`, { headers: { Authorization: `Bearer ${await this.accessToken()}`, "User-Agent": USER_AGENT } });
    return (response.data?.children ?? [])
      .map((child) => child.data)
      .filter((post): post is NonNullable<typeof post> => Boolean(post?.title && post.permalink))
      .map((post) => ({
        title: `r/${post.subreddit ?? "?"}: ${post.title}`,
        url: `https://www.reddit.com${post.permalink}`,
        text: `r/${post.subreddit ?? "?"} · u/${post.author ?? "unknown"} · ${post.score ?? 0} points · ${post.num_comments ?? 0} comments\n\n${post.title}\n\n${truncate((post.selftext ?? "").trim(), 6_000)}`.trim(),
        provider: this.id,
        category: this.category,
      }));
  }

  private accessToken(): Promise<string> {
    this.token ??= this.http
      .json<{ access_token?: string }>("Reddit", "https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.env.REDDIT_CLIENT_ID}:${this.env.REDDIT_CLIENT_SECRET}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: "grant_type=client_credentials",
      })
      .then((answer) => {
        if (!answer.access_token) throw new ToolUseError("Reddit did not give an access token; check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.");
        return answer.access_token;
      });
    this.token.catch(() => (this.token = undefined));
    return this.token;
  }
}

/** Hacker News stories and comments through Algolia. Free, no key. */
export class HackerNews implements ISourceProvider {
  readonly id = "hackernews";
  readonly category = "community" as const;
  constructor(private readonly http: Http) {}
  missing = () => null;

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const params = new URLSearchParams({ query: needQuery(request), tags: "(story,comment)", hitsPerPage: String(Math.min(request.limit, 25)) });
    const response = await this.http.json<{
      hits?: Array<{ objectID: string; title?: string | null; story_title?: string | null; story_text?: string | null; comment_text?: string | null; author?: string; points?: number | null; created_at?: string }>;
    }>("Hacker News", `https://hn.algolia.com/api/v1/search?${params}`);
    return (response.hits ?? [])
      .map((hit) => ({ hit, body: htmlToText(hit.comment_text ?? hit.story_text ?? "") }))
      .filter(({ hit, body }) => body || hit.title)
      .map(({ hit, body }) => {
        const heading = hit.title ?? hit.story_title ?? "Comment";
        return {
          title: `Hacker News: ${heading}`,
          url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          text: `${hit.author ?? "unknown"} · ${hit.created_at?.slice(0, 10) ?? "date unknown"}${hit.points != null ? ` · ${hit.points} points` : ""}\n\n${heading}\n\n${truncate(body, 6_000)}`.trim(),
          provider: this.id,
          category: this.category,
        };
      });
  }
}

/** Ads in Meta's Ad Library. Commercial ads are only published for some regions (EU/UK); elsewhere political ads only. */
export class MetaAdLibrary implements ISourceProvider {
  readonly id = "meta-ads";
  readonly category = "ads" as const;
  constructor(private readonly env: Env, private readonly http: Http) {}
  missing = () => (this.env.META_AD_LIBRARY_TOKEN?.trim() ? null : "META_AD_LIBRARY_TOKEN");

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const params = new URLSearchParams({
      search_terms: needQuery(request),
      ad_type: "ALL",
      ad_active_status: "ACTIVE",
      ad_reached_countries: `['${request.country.toUpperCase()}']`,
      fields: "page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_snapshot_url,publisher_platforms",
      limit: String(Math.min(request.limit, 25)),
      access_token: this.env.META_AD_LIBRARY_TOKEN!,
    });
    const version = this.env.META_GRAPH_VERSION?.trim() || "v27.0";
    const response = await this.http.json<{
      data?: Array<{ page_name?: string; ad_creative_bodies?: string[]; ad_creative_link_titles?: string[]; ad_delivery_start_time?: string; ad_snapshot_url?: string; publisher_platforms?: string[] }>;
    }>("Meta Ad Library", `https://graph.facebook.com/${version}/ads_archive?${params}`);
    return (response.data ?? [])
      .filter((ad) => ad.ad_creative_bodies?.length || ad.ad_creative_link_titles?.length)
      .map((ad) => ({
        title: `Meta ad by ${ad.page_name ?? "unknown"}`,
        // The snapshot URL carries the access token, so it is not passed on.
        text: [
          `Advertiser: ${ad.page_name ?? "unknown"}`,
          `Running since: ${ad.ad_delivery_start_time ?? "unknown"}${ad.publisher_platforms?.length ? ` on ${ad.publisher_platforms.join(", ")}` : ""}`,
          ...(ad.ad_creative_link_titles?.length ? [`Headline: ${ad.ad_creative_link_titles.join(" | ")}`] : []),
          ...(ad.ad_creative_bodies?.length ? [`Text: ${truncate(ad.ad_creative_bodies.join("\n---\n"), 2_000)}`] : []),
        ].join("\n"),
        provider: this.id,
        category: this.category,
      }));
  }
}
