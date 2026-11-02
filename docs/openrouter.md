# OpenRouter in the coding agent

Cognition Panel can save an OpenRouter API key for the current local operator in PostgreSQL.
The key is shared across that operator's projects. Saving a new key replaces the old
one; removing it prevents future launches from using it. An already running process
keeps its in-memory credential until it exits.

## Server setup

Set `KUSHEX_CREDENTIAL_ENCRYPTION_KEY` to a base64-encoded, random 32-byte value.
Generate one with `openssl rand -base64 32`, then save it in your deployment's secret
environment (or the ignored `kushex/.env.credentials` for local Docker Compose). Keep this value stable across
restarts and back it up separately from the database. Changing it makes existing
credentials unreadable; you must restore the old value or replace the saved API keys.
The server refuses to save credentials without a valid encryption key.

Apply database migrations with `pnpm --filter @kushex/server migrate`, then restart
the backend with the encryption key in its environment. Docker Compose's `migrate`
service applies the migration automatically when starting the stack:

```sh
docker compose --env-file .env -f docker/compose.standalone.yml up --build -d
```

If your deployment uses `docker/compose.local.yml`, retain that override when restarting
so configured project workspace mounts remain available:

```sh
docker compose --env-file .env -f docker/compose.standalone.yml -f docker/compose.local.yml up -d --no-deps --wait backend
```

The encryption key is excluded from agent process environments. The saved API key
is encrypted using AES-256-GCM with a fresh nonce per write. GET endpoints return
only saved status and update time; the browser cannot read the stored API key.
Cognition Panel currently uses its local operator identity, so these settings are intended
for the existing local deployment and its Host/Origin protections.

## Choose models

1. Open Cognition Panel **Settings → OpenRouter**.
2. Enter your OpenRouter API key and click **Save API key**, then **Test connection**.
   The key is shared across projects and the input clears after saving.
3. Open the coding agent’s **Configure → Workflow** tab and select a model-using step.
   Search its **Models** fields by provider/model ID or display name and select an
   OpenRouter model. Choose a default model or override individual roles. Blank role fields inherit the default. Existing Codex
   model names still use Codex CLI.
4. Click **Save** to persist the project's model choices. New runs pin those choices;
   resumed runs retain their original model IDs and use the currently saved key.

Model IDs are saved as `openrouter:<provider>/<model>`, for example
`openrouter:anthropic/claude-sonnet-4`. Searching does not change the selected model.
The catalog loads when opening the configuration panel. A failed load offers
**Retry models**; a missing key directs you to **Settings → OpenRouter**.
Only text-output models with IDs accepted by Kushibot's gateway are offered.

The runner fetches current context/output limits, then calls OpenRouter's stateless
Responses API through Kushibot's bounded model gateway. Keys travel separately over
private server-to-runner IPC and are excluded from project configuration, pinned run
files, prompts and normal debug payloads. Missing keys or unavailable models fail with
an actionable error; requests never silently fall back to a different provider.

This integration changes the coding agent's model roles. JEV decisions still use the
existing `KUSHEX_JEV_API_KEY` configuration. No additional OpenRouter SDK is needed.

API references: [model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
and [Responses API](https://openrouter.ai/docs/api/reference/responses/overview).
