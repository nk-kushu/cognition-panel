# Research Agent (agent id `research`)

Fills cognition's **Research** stages (feature 0017) for one app. It keeps no data and computes no
percentages: every read and write goes through the cognition API, which verifies each quote against
its document and each `fact` against its section. Findings it writes start as `proposed`.

| Capability | Command | What it does |
|---|---|---|
| `analyze` | `/analyze <document id or title>` | Reads a Knowledge document in parts, proposes cited facts, links them to known findings, classifies the source. |
| `discover` | `/discover <тема>` | Goes out and finds evidence: demand, competitors, ads, people's own words, reviews. Saves the raw results as Knowledge documents, then files cited facts like `/analyze`. |
| `gaps` | `/gaps` | Explains the blind spots and gives concrete next tasks. Read-only. Also the fallback. |

Without a command, one kushibot `DecisionUnit` call on the fast model picks the capability.

## `/discover`: where the evidence comes from

Two sources per category. A source without its key is skipped and named in the answer; the other one still runs.

| Category | Tool | Sources (setting) | Evidence weight |
|---|---|---|---|
| Keywords and demand | `search_keywords` | `dataforseo-volume`, `google-trends` (`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`) | competitor data |
| Web search | `search_web` | `tavily` (`TAVILY_API_KEY`) → `brave` (`BRAVE_SEARCH_API_KEY`) | competitor data |
| Competitor ads | `search_ads` | `meta-ads` (`META_AD_LIBRARY_TOKEN`), `google-ads` (DataForSEO) | competitor data |
| Communities | `search_community` | `reddit` (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`), `hackernews` (no key) | real user quote |
| Reviews | `search_reviews` | `google-play`, `app-store` (DataForSEO), `g2` (`FIRECRAWL_API_KEY`) | real user quote |
| Pages | `fetch_page` | `firecrawl` (`FIRECRAWL_API_KEY`) → `static-fetch` (no key, no JavaScript) | competitor data |

Where the keys come from: **cognition → Settings → AI → Market sources**. Saving a key there stores it encrypted in cognition and sends it to
Cognition Panel (`PUT /api/integrations/marketing/<NAME>`), which keeps its own encrypted copy and hands it to this agent as `credentials`
(the same path as the OpenRouter key). The environment variable of the same name is the fallback when no key was saved.
Optional, environment only: `META_GRAPH_VERSION` (default `v27.0`), `FIRECRAWL_API_URL`.

How a run goes: `research_overview` → pick up to 3 weak sections → search → `save_source` → `read_document` → `propose_finding`.

- **Quotes stay real.** Search results are kept inside the run under ids (`r1`, `r2`, …). `save_source` writes the provider's own text
  into the document, so cognition's quote check runs against what the source said, not what the model remembers.
- **Evidence type is not the model's call.** Communities and reviews are saved as `real_user_quote`, everything else as `competitor_data`; results of
  different weight cannot share a document.
- **Untrusted input.** Result text is data. `fetch_page` refuses localhost, private and Docker-internal addresses (checked by name, not by DNS).
  API keys never appear in tool results.
- **Limits per run:** 14 searches, 8 page reads, 6 saved documents (`DEFAULT_MARKETING_LIMITS`), plus the finding limits above.
- **Known limits.** Meta publishes commercial ads only for some regions (EU/UK); elsewhere only political ads. Google Ads results carry
  advertiser, format and dates, not ad text. App reviews are queued by DataForSEO and take up to about a minute. The static page reader cannot run JavaScript.

## How it finds the app and cognition

- **App:** `configuration.appId` when cognition's Research view starts the run. From the panel chat,
  the app whose `appDir` ends like the chat project's workspace (at least 2 path segments).
- **API:** `configuration.cognitionApiUrl` → `COGNITION_API_URL` → `http://host.docker.internal:3000/api`.
- **Key:** the OpenRouter key saved in the panel (`research` is in `AGENTS_WITH_PROVIDER_CREDENTIALS`),
  else `OPENROUTER_API_KEY`. The key is checked at start; a rejected key fails the run with a clear message.

## Tools and per-run limits

| Tool | cognition API | Limit |
|---|---|---|
| `research_overview`, `list_documents` | `GET /local-apps/:id/research`, `…/knowledge/documents` | — |
| `read_document` | `GET …/knowledge/documents/:id` (20 000 chars per part) | 30 parts |
| `propose_finding` | `POST /harness/findings` | 40 |
| `link_findings` | `POST /harness/findings/:id/links` | 40 |
| `set_evidence_type` | `PATCH …/research/documents/:id/evidence-type` (only when unknown) | — |

A 4xx from cognition comes back to the model as `{ error }` so it can correct itself; 5xx and network
errors stop the run. `src/sections.ts` mirrors cognition's section list; keep them in sync.

## Models (OpenRouter, Zero Data Retention)

| Role | Default | Override |
|---|---|---|
| main | `moonshotai/kimi-k3` | `RESEARCH_MODEL` |
| fast (routing) | `deepseek/deepseek-v4.1-flash` | `RESEARCH_FAST_MODEL` |

## Tests

```sh
npm test                 # unit tests, no network
# against a running cognition, from the panel container (no model, no writes):
tsx tests/live-smoke.ts /roots/PersonalProjects/KushiBox/cognition/apps/test
tsx tests/live-smoke-reject.ts <appId> <documentId>
```

Restart Cognition Panel after changing the manifest.
