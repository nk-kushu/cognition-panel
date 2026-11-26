# Cognition router (agent id `cognition`)

The agent behind cognition's general chat. It answers nothing itself: for each message it picks
**which agent** answers and runs that agent's `chat()` in the same process with the same request.

| Agent | Commands |
|---|---|
| `idea-planner` (Cognition Assistant, fallback) | `/idea`, `/ask`, `/clarify` |
| `research` (Research Agent) | `/analyze`, `/discover`, `/gaps`, `/plan` |

## How it chooses

1. A leading slash command → the agent whose manifest declares it. No model call.
2. Free text → one kushibot `DecisionUnit` on the fast model (`COGNITION_ROUTER_MODEL`, default
   `deepseek/deepseek-v4.1-flash`). Evidence: the message, the last 4 turns, the thread's previous
   agent and each agent's manifest description.
3. No decision (abstained, invalid output, no key, rejected key) → the thread's previous agent, else
   `idea-planner`. The router never fails because of its own model; the chosen agent reports a key problem.

The first progress line says who answers: `→ Research Agent (команда | избор | резервен вариант)`.

The previous agent per thread is kept in `<tmpdir>/kushex-cognition-router/<threadId>.json`, because
the panel records only the router's name per turn. Losing it only drops that hint.

## Adding an agent

1. Add its id to `TARGET_AGENTS` in `agent.ts` (the first entry is the fallback).
2. Add its commands to `commands` in this `kushex-plugin.json`. Every run checks that the list equals
   the agents' commands and that no command belongs to two agents.
3. Add the agent to `AGENTS_WITH_PROVIDER_CREDENTIALS` in the panel if it calls OpenRouter.
4. Restart Cognition Panel.

```sh
npm test   # 17 tests, no network
```
