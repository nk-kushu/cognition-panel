# Research Agent (agent id `research`)

Fills cognition's **Research** stages (feature 0017) for one app. It keeps no data and computes no
percentages: every read and write goes through the cognition API, which verifies each quote against
its document and each `fact` against its section. Findings it writes start as `proposed`.

| Capability | Command | What it does |
|---|---|---|
| `analyze` | `/analyze <document id or title>` | Reads a Knowledge document in parts, proposes cited facts, links them to known findings, classifies the source. |
| `plan` | `/plan` | Writes the business plan: a Lean Canvas from **accepted** findings only (each statement cites them; empty blocks get a `gap`), plus the inputs of the financial model. cognition checks the citations and computes every number. |
| `sources` | `/sources` | Plans a search by hand: which sites (Reddit, Hacker News, G2, app stores, Meta Ad Library, search pages, Keyword Planner, Google Trends, Ads Transparency, competitor pricing pages, official legal sources) to open for this idea, what to search for on each, what to note, and which evidence type to choose when sending the page to Knowledge. Read-only; the catalog is in `src/sources.ts`. |
| `gaps` | `/gaps` | Explains the blind spots and gives concrete next tasks. Read-only. Also the fallback. |

Without a command, one kushibot `DecisionUnit` call on the fast model picks the capability.

## Evidence comes from you

The agent does not search the web. The evidence is what you put into **Knowledge**: pasted text, files, or pages sent with the
Cognition Capture browser extension (`cognition-extension`). `/sources` says where to look and what to note on each site; `/analyze`
turns the documents into cited findings. Set the evidence type of each document yourself (real people, official source, competitor
data, AI idea): it decides how much a finding weighs.

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
| `read_idea` | `GET /local-apps/:id/idea` | — |
| `business_plan_overview` | `GET …/business-plan` | — |
| `save_business_plan` | `POST …/business-plan/versions` (only accepted findings may be cited) | 3 |
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
