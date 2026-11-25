import { ToolUseError } from "../../ToolBox";
import type { Http } from "../Http";
import { ProviderError } from "../Http";
import { htmlToText, refusedUrl, truncate } from "../Text";
import type { Category, Env, ISourceProvider, ProviderRequest, SourceItem } from "../types";

const PAGE_CHARS = 30_000;

function needQuery(request: ProviderRequest): string {
  const query = request.query?.trim();
  if (!query) throw new ToolUseError("query is required.");
  return query;
}

/** Web search that returns cleaned page excerpts. */
export class Tavily implements ISourceProvider {
  readonly id = "tavily";
  readonly category = "web" as const;
  constructor(private readonly env: Env, private readonly http: Http) {}
  missing = () => (this.env.TAVILY_API_KEY?.trim() ? null : "TAVILY_API_KEY");

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const response = await this.http.json<{ results?: Array<{ title?: string; url?: string; content?: string }> }>("Tavily", "https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.TAVILY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: needQuery(request), max_results: request.limit, search_depth: "basic" }),
    });
    return (response.results ?? []).filter((result) => result.url && result.content).map((result) => ({
      title: result.title?.trim() || result.url!, url: result.url!, text: result.content!.trim(), provider: this.id, category: this.category,
    }));
  }
}

/** Independent web index; the fallback when Tavily is missing or failing. */
export class Brave implements ISourceProvider {
  readonly id = "brave";
  readonly category = "web" as const;
  constructor(private readonly env: Env, private readonly http: Http) {}
  missing = () => (this.env.BRAVE_SEARCH_API_KEY?.trim() ? null : "BRAVE_SEARCH_API_KEY");

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const params = new URLSearchParams({ q: needQuery(request), count: String(Math.min(request.limit, 20)), country: request.country.toLowerCase(), search_lang: request.language });
    const response = await this.http.json<{ web?: { results?: Array<{ title?: string; url?: string; description?: string }> } }>(
      "Brave Search", `https://api.search.brave.com/res/v1/web/search?${params}`,
      { headers: { Accept: "application/json", "X-Subscription-Token": this.env.BRAVE_SEARCH_API_KEY! } },
    );
    return (response.web?.results ?? []).filter((result) => result.url && result.description).map((result) => ({
      title: htmlToText(result.title ?? "") || result.url!, url: result.url!, text: htmlToText(result.description!), provider: this.id, category: this.category,
    }));
  }
}

/** Reads a page as markdown, JavaScript included. Also the way into G2-style review sites. */
export class Firecrawl implements ISourceProvider {
  readonly category: Category;
  constructor(private readonly env: Env, private readonly http: Http, readonly id: "firecrawl" | "g2" = "firecrawl") {
    this.category = id === "g2" ? "reviews" : "pages";
  }
  missing = () => (this.env.FIRECRAWL_API_KEY?.trim() ? null : "FIRECRAWL_API_KEY");

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const url = request.target?.trim();
    if (!url) throw new ToolUseError("url is required.");
    const refused = refusedUrl(url);
    if (refused) throw new ToolUseError(`Cannot read ${url}: ${refused}.`);
    const base = (this.env.FIRECRAWL_API_URL?.trim() || "https://api.firecrawl.dev/v1").replace(/\/+$/, "");
    const response = await this.http.json<{ success?: boolean; error?: string; data?: { markdown?: string; metadata?: { title?: string } } }>(
      "Firecrawl", `${base}/scrape`,
      { method: "POST", headers: { Authorization: `Bearer ${this.env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }) },
      90_000,
    );
    const markdown = response.data?.markdown?.trim();
    if (!response.success || !markdown) throw new ProviderError(`Firecrawl could not read the page${response.error ? `: ${response.error}` : ""}.`);
    return [{ title: response.data?.metadata?.title?.trim() || url, url, text: truncate(markdown, PAGE_CHARS), provider: this.id, category: this.category }];
  }
}

/** A plain GET with the HTML turned into text. Needs no key; cannot run JavaScript. */
export class StaticFetch implements ISourceProvider {
  readonly id = "static-fetch";
  readonly category = "pages" as const;
  constructor(private readonly http: Http) {}
  missing = () => null;

  async fetch(request: ProviderRequest): Promise<SourceItem[]> {
    const url = request.target?.trim();
    if (!url) throw new ToolUseError("url is required.");
    const refused = refusedUrl(url);
    if (refused) throw new ToolUseError(`Cannot read ${url}: ${refused}.`);
    const { text, contentType } = await this.http.text("The page", url, { redirect: "follow", headers: { "User-Agent": "cognition-research-agent/0.1", Accept: "text/html,text/plain,text/markdown" } }, 20_000);
    if (contentType && !/text\/|html|xml|json/i.test(contentType)) throw new ToolUseError(`${url} is not a text page (${contentType}).`);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
    const body = /html/i.test(contentType) || /<html|<body/i.test(text) ? htmlToText(text) : text.trim();
    if (body.length < 80) throw new ToolUseError(`${url} has no readable text (it may need JavaScript; try again with a Firecrawl key).`);
    return [{ title: (title && htmlToText(title)) || url, url, text: truncate(body, PAGE_CHARS), provider: this.id, category: this.category }];
  }
}
