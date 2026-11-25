import assert from "node:assert/strict";
import { test } from "node:test";
import { CapabilityRegistry } from "../src/capabilities/CapabilityRegistry";
import { Http, type Fetch } from "../src/marketing/Http";
import { MarketingTools, type MarketingToolId } from "../src/marketing/MarketingTools";
import { createProviders } from "../src/marketing/providers";
import { htmlToText, refusedUrl } from "../src/marketing/Text";
import type { Env } from "../src/marketing/types";
import { ToolBox } from "../src/ToolBox";

const ALL: MarketingToolId[] = ["search_keywords", "search_web", "search_ads", "search_community", "search_reviews", "fetch_page", "save_source"];

type Seen = { url: string; method: string; headers: Record<string, string>; body?: string };

/** A network stand-in: the first route whose key is a prefix of the URL answers; everything is recorded. */
function network(routes: Record<string, (seen: Seen) => unknown>) {
  const seen: Seen[] = [];
  const fetchImpl: Fetch = async (url, init) => {
    const entry: Seen = { url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, ...(typeof init?.body === "string" ? { body: init.body } : {}) };
    seen.push(entry);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) throw new Error(`unexpected request ${url}`);
    const answer = routes[key]!(entry);
    if (answer instanceof Response) return answer;
    return new Response(typeof answer === "string" ? answer : JSON.stringify(answer), { status: 200, headers: { "Content-Type": typeof answer === "string" ? "text/html" : "application/json" } });
  };
  return { seen, fetchImpl };
}

function setup(env: Env, routes: Record<string, (seen: Seen) => unknown>, cognition: Record<string, (body: unknown) => unknown> = {}) {
  const net = network(routes);
  const signal = new AbortController().signal;
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const client = {
    post: async <T>(path: string, body: unknown) => (calls.push({ method: "POST", path, body }), (cognition[`POST ${path}`]?.(body) ?? {}) as T),
    patch: async <T>(path: string, body: unknown) => (calls.push({ method: "PATCH", path, body }), (cognition[`PATCH ${path}`]?.(body) ?? {}) as T),
  };
  const providers = createProviders(env, new Http(signal, net.fetchImpl), signal, async () => {});
  const tools = new MarketingTools(client, "app-1", providers, () => {}, ALL, undefined, () => "2026-11-25");
  const box = new ToolBox([tools]);
  const call = async (toolId: string, args: Record<string, unknown>) =>
    ((await box.dispatch({ operationId: "op", toolId, arguments: args } as never)) as { observation: { value: Record<string, any> } }).observation.value;
  return { ...net, calls, tools, call };
}

const hnHits = {
  hits: [
    { objectID: "42", title: null, story_title: "Ask HN: CRM for salons?", comment_text: "We lose <b>3 hours</b> a week on bookings &amp; reminders.", author: "anna", points: null, created_at: "2026-05-01T10:00:00Z" },
    { objectID: "43", title: "Show HN: Booker", story_text: null, author: "bob", points: 12, created_at: "2026-06-01T10:00:00Z" },
  ],
};

// ── Text helpers ─────────────────────────────────────────────────────────

test("turns HTML into plain text and keeps paragraphs apart", () => {
  assert.equal(htmlToText("<style>x{}</style><p>Fish &amp; chips</p><p>Two<br>lines</p><script>evil()</script>"), "Fish & chips\n\nTwo\nlines".replace("\n\n", "\n"));
});

test("refuses internal and private addresses, allows public pages", () => {
  for (const url of ["http://localhost:3000/", "http://host.docker.internal:3000/api", "http://169.254.169.254/latest", "http://10.0.0.5/", "http://192.168.1.2/", "http://[::1]/", "ftp://example.com/", "http://intranet/", "https://user:pw@example.com/"])
    assert.ok(refusedUrl(url), url);
  assert.equal(refusedUrl("https://www.calendly.com/pricing"), null);
});

// ── Source choice and keys ───────────────────────────────────────────────

test("web search uses Tavily, and falls back to Brave when Tavily fails", async () => {
  const ok = setup(
    { TAVILY_API_KEY: "t", BRAVE_SEARCH_API_KEY: "b" },
    { "https://api.tavily.com/search": () => ({ results: [{ title: "Pricing", url: "https://x.com/p", content: "Pro is $29/month" }] }) },
  );
  const first = await ok.call("search_web", { query: "x pricing" });
  assert.equal(first.results[0].source, "tavily");
  assert.equal(ok.seen.length, 1);

  const down = setup(
    { TAVILY_API_KEY: "t", BRAVE_SEARCH_API_KEY: "b" },
    {
      "https://api.tavily.com/search": () => new Response("no", { status: 429 }),
      "https://api.search.brave.com/res/v1/web/search": () => ({ web: { results: [{ title: "<b>Pricing</b>", url: "https://x.com/p", description: "Pro is $29/month" }] } }),
    },
  );
  const second = await down.call("search_web", { query: "x pricing" });
  assert.equal(second.results[0].source, "brave");
  assert.equal(second.results[0].title, "Pricing");
  assert.match(second.notes[0], /tavily: Tavily rate limit/);
});

test("a category with no key says which setting enables it", async () => {
  const none = setup({}, {});
  const answer = await none.call("search_web", { query: "x" });
  assert.match(answer.error, /No web source is set up \(tavily: set TAVILY_API_KEY; brave: set BRAVE_SEARCH_API_KEY\)/);
  assert.equal(none.seen.length, 0);
});

test("community search merges Hacker News (no key) with Reddit when it is set up", async () => {
  const run = setup(
    { REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "secret" },
    {
      "https://hn.algolia.com/api/v1/search": () => hnHits,
      "https://www.reddit.com/api/v1/access_token": () => ({ access_token: "tok" }),
      "https://oauth.reddit.com/search": (seen) => {
        assert.equal(seen.headers.Authorization, "Bearer tok");
        return { data: { children: [{ data: { title: "Hate manual booking", selftext: "I lose 3 hours", subreddit: "smallbusiness", author: "cara", permalink: "/r/smallbusiness/1", score: 5, num_comments: 2 } }] } };
      },
    },
  );
  const answer = await run.call("search_community", { query: "salon booking pain" });
  assert.deepEqual(answer.results.map((result: { source: string }) => result.source).sort(), ["hackernews", "hackernews", "reddit"]);
  const hn = answer.results.find((result: { title: string }) => result.title.includes("Ask HN"));
  assert.equal(hn.url, "https://news.ycombinator.com/item?id=42");

  const onlyHn = setup({}, { "https://hn.algolia.com/api/v1/search": () => hnHits });
  const hnAnswer = await onlyHn.call("search_community", { query: "x" });
  assert.equal(hnAnswer.results.length, 2);
  assert.deepEqual(hnAnswer.notSetUp, [{ source: "reddit", missing: "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET" }]);
});

// ── DataForSEO ───────────────────────────────────────────────────────────

const dfs: Env = { DATAFORSEO_LOGIN: "me", DATAFORSEO_PASSWORD: "pw" };

test("keyword search combines search volume and the Trends direction", async () => {
  const run = setup(dfs, {
    "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live": (seen) => {
      assert.equal(seen.headers.Authorization, `Basic ${Buffer.from("me:pw").toString("base64")}`);
      assert.deepEqual(JSON.parse(seen.body!)[0], { keywords: ["salon software"], location_name: "Germany", language_code: "en" });
      return { tasks: [{ status_code: 20000, result: [{ keyword: "salon software", search_volume: 2400, competition: "HIGH", cpc: 4.2, monthly_searches: [{ year: 2026, month: 10, search_volume: 2600 }] }] }] };
    },
    "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live": () => ({
      tasks: [{ status_code: 20000, result: [{ items: [{ type: "google_trends_graph", data: [10, 12, 14, 30, 40, 55, 60, 70].map((value) => ({ values: [value] })) }] }] }],
    }),
  });
  const answer = await run.call("search_keywords", { keywords: ["salon software"], country: "de" });
  const texts = answer.results.map((result: { preview: string }) => result.preview).join("\n");
  assert.match(texts, /Monthly searches \(average\): 2400/);
  assert.match(texts, /Direction: rising/);
});

test("app reviews are polled until the task is ready and filtered to complaints", async () => {
  let polls = 0;
  const run = setup(dfs, {
    "https://api.dataforseo.com/v3/app_data/google/app_reviews/task_post": () => ({ tasks: [{ id: "task-1", status_code: 20100 }] }),
    "https://api.dataforseo.com/v3/app_data/google/app_reviews/task_get/task-1": () =>
      ++polls < 2
        ? { tasks: [{ status_code: 40602, status_message: "Task In Queue" }] }
        : { tasks: [{ status_code: 20000, result: [{ items: [
            { review_text: "Love it", rating: { value: 5 }, user_profile: { profile_name: "a" } },
            { review_text: "Crashes when I book", rating: { value: 1 }, user_profile: { profile_name: "b" }, timestamp: "2026-10-01" },
          ] }] }] },
  });
  const answer = await run.call("search_reviews", { source: "google-play", target: "com.example.app", maxRating: 2 });
  assert.equal(polls, 2);
  assert.equal(answer.results.length, 1);
  assert.match(answer.results[0].preview, /Crashes when I book/);
});

test("search_reviews demands a source and rejects an unknown one", async () => {
  const run = setup(dfs, {});
  assert.match((await run.call("search_reviews", { target: "x" })).error, /source is required/);
  assert.match((await run.call("search_reviews", { source: "yelp", target: "x" })).error, /Unknown source yelp/);
});

// ── Ads ──────────────────────────────────────────────────────────────────

test("ads: Meta and Google answer by their own input, and the Meta token never reaches the model", async () => {
  const run = setup({ ...dfs, META_AD_LIBRARY_TOKEN: "SECRET-TOKEN" }, {
    "https://graph.facebook.com/v27.0/ads_archive": (seen) => {
      assert.match(seen.url, /ad_reached_countries=%5B%27DE%27%5D/);
      return { data: [{ page_name: "Treatwell", ad_creative_bodies: ["Book in 30 seconds"], ad_delivery_start_time: "2026-09-01", ad_snapshot_url: "https://facebook.com/ads/archive/render_ad/?access_token=SECRET-TOKEN" }] };
    },
    "https://api.dataforseo.com/v3/serp/google/ads_search/live/advanced": () => ({ tasks: [{ status_code: 20000, result: [{ items: [{ title: "Treatwell", format: "text", first_shown: "2026-01-01", last_shown: "2026-11-01", url: "https://adstransparency.google.com/x" }] }] }] }),
  });
  const answer = await run.call("search_ads", { query: "treatwell", domain: "treatwell.de", country: "DE" });
  assert.deepEqual(answer.results.map((result: { source: string }) => result.source).sort(), ["google-ads", "meta-ads"]);
  assert.ok(!JSON.stringify(answer).includes("SECRET-TOKEN"));
  assert.match((await run.call("search_ads", {})).error, /needs query/);
});

// ── Pages ────────────────────────────────────────────────────────────────

test("fetch_page uses Firecrawl first, static fetch without a key, and never reads internal hosts", async () => {
  const withKey = setup({ FIRECRAWL_API_KEY: "f" }, { "https://api.firecrawl.dev/v1/scrape": () => ({ success: true, data: { markdown: "# Pricing\nPro $29", metadata: { title: "Pricing" } } }) });
  assert.equal((await withKey.call("fetch_page", { url: "https://x.com/pricing" })).results[0].source, "firecrawl");

  const page = `<html><head><title>X Pricing</title></head><body><h1>Plans</h1><p>${"The Pro plan costs 29 dollars per month. ".repeat(5)}</p><script>steal()</script></body></html>`;
  const plain = setup({}, { "https://x.com/pricing": () => page });
  const answer = await plain.call("fetch_page", { url: "https://x.com/pricing" });
  assert.equal(answer.results[0].source, "static-fetch");
  assert.equal(answer.results[0].title, "X Pricing");
  assert.ok(!answer.results[0].preview.includes("steal"));

  for (const url of ["http://localhost:3000/api", "http://169.254.169.254/latest/meta-data"]) {
    const blocked = setup({ FIRECRAWL_API_KEY: "f" }, {});
    assert.match((await blocked.call("fetch_page", { url })).error, /Cannot read/);
    assert.equal(blocked.seen.length, 0);
  }
});

// ── Saving to Knowledge ──────────────────────────────────────────────────

test("save_source stores the provider's own text and sets the evidence type from the sources", async () => {
  const run = setup({}, { "https://hn.algolia.com/api/v1/search": () => hnHits }, { "POST /local-apps/app-1/knowledge/documents": () => [{ id: "doc-9" }] });
  const found = await run.call("search_community", { query: "salon" });
  const saved = await run.call("save_source", { resultIds: [found.results[0].id], title: "HN: salon pain" });
  assert.deepEqual(saved, { documentId: "doc-9", evidenceType: "real_user_quote", chars: saved.chars });

  const post = run.calls[0]!;
  const document = (post.body as { documents: Array<Record<string, string>> }).documents[0]!;
  assert.equal(document.origin, "agent");
  assert.equal(document.sourceKind, "web");
  assert.equal(document.sourceName, "discover-hn-salon-pain-2026-11-25.md");
  assert.equal(document.sourceUrl, "https://news.ycombinator.com/item?id=42");
  assert.ok(document.contentMd!.includes("We lose 3 hours a week on bookings & reminders."), "the quote must be the provider's text, verbatim");
  assert.deepEqual(run.calls[1], { method: "PATCH", path: "/local-apps/app-1/research/documents/doc-9/evidence-type", body: { evidenceType: "real_user_quote" } });
});

test("save_source marks competitor data apart and refuses to mix weights or invent ids", async () => {
  const run = setup(
    { TAVILY_API_KEY: "t" },
    {
      "https://api.tavily.com/search": () => ({ results: [{ title: "Pricing", url: "https://x.com/p", content: "Pro is $29/month" }] }),
      "https://hn.algolia.com/api/v1/search": () => hnHits,
    },
    { "POST /local-apps/app-1/knowledge/documents": () => [{ id: "doc-1" }] },
  );
  const web = await run.call("search_web", { query: "x" });
  const hn = await run.call("search_community", { query: "x" });
  assert.match((await run.call("save_source", { resultIds: [web.results[0].id, hn.results[0].id], title: "mixed" })).error, /different weight/);
  assert.match((await run.call("save_source", { resultIds: ["r999"], title: "ghost" })).error, /Unknown result id r999/);
  assert.equal((await run.call("save_source", { resultIds: [web.results[0].id], title: "Pricing" })).evidenceType, "competitor_data");
});

test("search and save limits end a run's spending", async () => {
  const net = network({ "https://hn.algolia.com/api/v1/search": () => hnHits });
  const signal = new AbortController().signal;
  const tools = new MarketingTools({ post: async () => [{ id: "d" }] as never, patch: async () => ({}) as never }, "app-1", createProviders({}, new Http(signal, net.fetchImpl), signal), () => {}, ALL, { searches: 2, fetches: 1, saves: 1 });
  const box = new ToolBox([tools]);
  const call = async (toolId: string, args: Record<string, unknown>) =>
    ((await box.dispatch({ operationId: "op", toolId, arguments: args } as never)) as { observation: { value: Record<string, any> } }).observation.value;
  await call("search_community", { query: "a" });
  await call("search_community", { query: "b" });
  assert.match((await call("search_community", { query: "c" })).error, /searches limit for this run \(2\) is used up/);
});

// ── Wiring ───────────────────────────────────────────────────────────────

test("the registry offers /discover and the manifest lists it", () => {
  const registry = CapabilityRegistry.default();
  assert.equal(registry.command("/discover")?.id, "discover");
  assert.ok(registry.get("discover").instructions().includes("untrusted"));
});
