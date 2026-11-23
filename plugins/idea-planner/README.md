# Cognition Assistant (agent id `idea-planner`)

A read-only assistant for the cognition platform. For each message it first picks a
**capability**, then runs it. It changes no files, notes, features or tasks.

| Capability | Command | When |
|---|---|---|
| `idea-analysis` | `/idea` | The user describes something to build. It understands the idea (goal, users, core features), reads the matching templates, and answers with what each template covers, what is missing, and an order of work. |
| `answer` | `/ask` | Questions, explanations and follow-ups. Reads templates when needed. Also the fallback. |
| `clarify` | `/clarify` | The message is too unclear to route. Asks one short question. |

## How a message is handled

1. **Step 0, routing** (`src/routing/CapabilityRouter.ts`). A leading slash command picks the
   capability directly. Otherwise one kushibot `DecisionUnit` call on the fast model chooses
   between the capability ids. Its evidence is the message, the last 4 conversation turns and each
   capability's `whenToUse`. Abstaining routes to `clarify`. Invalid output or an unavailable
   model routes to `answer`.
2. **The capability** runs as one kushibot session step with its own instructions, tools and model
   (`src/AssistantAgent.ts`). It receives the message and the last 10 conversation turns. Routing and
   the session share one run budget and one debug timeline.

To add a capability:

1. Implement `ICapability` in `src/capabilities/`.
2. Register it in `CapabilityRegistry.default()`.
3. Add its command to `commands` in `kushex-plugin.json`, with a one-line `description` (and
   optionally an `argument` hint) for the chat's `/` menu.
4. Restart Cognition Panel.

The panel never runs plugin code to learn commands, so the manifest is the list the chat shows.
Every run checks that the manifest and the registry list the same commands. If they differ, the run
fails with a message naming what to add or remove. The router learns about it from its `whenToUse`, so give it
concrete example requests.

## Models (OpenRouter)

| Role | Default | Override |
|---|---|---|
| main (idea analysis, answers) | `moonshotai/kimi-k3` | `IDEA_PLANNER_MODEL` |
| fast (routing, clarifying) | `deepseek/deepseek-v4.1-flash` | `IDEA_PLANNER_FAST_MODEL` |

Requests only go to Zero Data Retention endpoints (`zdr: true`, `data_collection: deny`). Choose
models that have one (see https://openrouter.ai/api/v1/endpoints/zdr). The API key is the
OpenRouter key saved in the panel's coding settings. The server passes it because `idea-planner`
is in `AGENTS_WITH_PROVIDER_CREDENTIALS` (`packages/server/.../AgentRunService.ts`).
`OPENROUTER_API_KEY` is the fallback.

## Templates

The agent reads templates from `IDEA_PLANNER_TEMPLATES_DIR`. Without it, it uses the first
`scaffolding/templates` (or `cognition/scaffolding/templates`) found walking up from the project
workspace. Reads stay inside that directory, skip `node_modules`, `dist` and binary files, and are
capped at 24 KB per file.

Restart Cognition Panel after changing the manifest.
