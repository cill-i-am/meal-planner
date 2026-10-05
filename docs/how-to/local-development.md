# Choose the local runtime

The repository has more than one way to run code locally. Check
[package.json](../../package.json), the [API scripts](../../apps/api/package.json)
and the [web scripts](../../apps/web/package.json) for the required versions and
commands. Install application tools with `pnpm install --frozen-lockfile` when
needed. Documentation checks need only Python 3.

## Native Alchemy development

Run `pnpm dev` from the repository root. This starts the actual Alchemy stack:
Website with Vite hot reload, API, D1 migrations, SQLite Durable Objects, queues,
Workflows, R2 and the local media container. Docker must be running for the media
container. Open the Website URL printed by Alchemy.

`pnpm dev` calls `alchemy dev --env-file .dev.vars` directly. Keep local application
configuration in the ignored `.dev.vars` file, separate from production `.env`.
For a fresh checkout, use `.env.example` as a reference and provide the app's
required auth secret, import token and opaque system identities. Existing local
configuration remains usable; no cloud credentials are needed for local storage.

Alchemy captures household SQL migrations during construction and embeds them
in the Worker, so the CLI needs no custom SQL import hook. The existing household
migration ledger is adopted in place; Drizzle still generates the SQL.

Alchemy selects its default `dev_<username>` stage. Local state and resource data
are held under `.alchemy/` and survive restarts. Use
`pnpm dev --stage dev_example` for a separate local environment, or
`pnpm exec alchemy dev --env-file PATH` for another application configuration.
Stop with Ctrl+C. These are Alchemy's native options, without a custom launcher.

The stack selects `Alchemy.localState()` during native dev and hosted Cloudflare
state for deployment. It skips live AI Gateway provisioning locally. Email uses
Alchemy's local simulator; inspect its emitted mail files. AI has no local
emulator: Alchemy prepares remote AI bindings, which require a valid Cloudflare
profile, and actual model calls incur provider charges. A missing AI profile does
not make the local auth and household features require a cloud deployment.

Follow [Alchemy local development](https://alchemy.run/cloudflare/local-development/)
for platform behavior and supported bindings. `pnpm dev:tesco` retains the separate
Node catalogue host; its configuration is documented in the
[API README](../../apps/api/README.md).

## Native stack integration tests

`pnpm test:stack` uses [Alchemy's test harness](https://alchemy.run/testing/)
with `dev: true`, the real stack and its default RPC sidecar topology. Each run
uses a unique local stage, disposable application secrets, real D1 migrations and
native service bindings. It checks Website/API readiness and household creation,
request replay and reads through the generated auth and Effect clients. The
harness destroys its stage after the suite. Keep Docker running for this test.
The Vitest configuration explicitly runs lifecycle hooks in registration order,
as required by Alchemy's sidecar cleanup.

## Live family and planning agent

Native development does not create agent gateways or API tokens. To use an
existing Cloudflare-billed model locally, supply `LOCAL_AGENT_ACCOUNT_ID`,
`LOCAL_AGENT_API_TOKEN`, `LOCAL_AGENT_GATEWAY_ID`,
`LOCAL_AGENT_CONVERSATION_CONFIG` and `LOCAL_AGENT_PRIVATE_DISCOVERY_CONFIG` in
your ignored environment file. The two config values use the provider schemas
in the [agent conversation reference](../reference/agent-conversations.md) and
[private discovery reference](../reference/private-discovery.md). Keep tokens
private. Missing local model settings leave auth and family storage available;
chat reports that its model is not configured. Actual inference uses Cloudflare
credits.

For this worktree's existing local dataset, the native command is:

```sh
pnpm exec alchemy dev --stage dev_cillian_a56d --profile ceird-admin-global --env-file .alchemy/local-dev.env
```

The Website requests port 4399; use the URL Alchemy prints if it is occupied.

### Persistent limited preview

Build the web Worker, then start the persistent local preview:

```sh
pnpm --filter @meal-planner/web build:e2e
pnpm dev:preview --profile meal-planner-local-ai --account ACCOUNT_ID --login
```

The first login creates a separate Alchemy profile limited to account
identification and Workers AI. Later starts can omit `--login`; use it again to
renew that profile's authorization. An existing profile with broader OAuth
scopes cannot be renewed through this command.

Open `http://127.0.0.1:4399`. The preview uses the production conversation Agent,
auth handlers and household Durable Objects. Chat sends messages to Workers AI
using `openai/gpt-6-luna` through Cloudflare's Responses endpoint. It consumes
prepaid AI Gateway credits; no separate OpenAI API key is needed. The first
inference request may create the account's default AI Gateway. Cloudflare returns
HTTP 402 when there are insufficient credits. Fund the gateway in the dashboard
before trying chat. Credentials stay in the server process. Starting the local
server does not deploy Workers or create remote databases or email resources.

Use `--gateway GATEWAY_ID` to select an existing gateway. The default is
`default`. `--model @cf/openai/gpt-oss-120b` explicitly selects the original
Workers AI model for comparison; the preview never falls back to it silently.

Local accounts, conversations and household data persist under
`.alchemy/local-preview/data`, including across Ctrl+C and restart. Keep this
ignored directory private. Use `--data-directory PATH` and `--port PORT` for a
separate local dataset. The server binds only to `127.0.0.1`. Stop it before
rebuilding the web Worker.

Family setup and shared planning conversations use the live model. Saved recipe
reads are available. Recipe import, private interview inference and member
departure workflows are not configured in this preview. Email is captured in
local KV storage and is never sent externally. Test seed, fault injection and
mail inspection routes are absent.

The auth and family test fixture uses scripted model responses for repeatable
tests. Use `dev:preview` when trying your own chat messages.

After building the web Worker, verify the preview's service connections without
calling a model:

```sh
node --import tsx apps/api/src/test/local-preview-family.test-fixture.ts
```

This smoke runs on port 4498 with disposable local data. It checks signup,
family creation, creator linking, person creation and exact request replay,
then stops its runtime and removes its temporary data.

### Deployed model bindings

The [deployed AI provider](../../apps/api/src/infrastructure/agent-provider.ts)
creates a gateway and a scoped account token for each Alchemy stage. The API
Worker and private interview Worker receive the gateway ID, model settings and
token through their bindings. Both use GPT-6 Luna through Cloudflare Responses.
The local preview above continues to use its own explicit loopback configuration
and does not create these deployed resources. Credit purchases remain an account
billing operation; deployment needs the intended Alchemy stage and profile.


## Verification

Run the relevant package checks and required CI checks. Root commands are
`pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm build`.
Use `pnpm test:container` for synthetic media tests. For focused API checks, run
`pnpm --filter @meal-planner/api test` for the Node/Workflow suites and
`pnpm --filter @meal-planner/worker-tests test` for native Worker/D1 test files.
Root `pnpm test` includes both. Ordinary suites use Vitest 5.0.3; the native
Worker workspace pins Vitest 4.1.11 for `@cloudflare/vitest-plugin` 1.3.6.
`pnpm test:stack` separately exercises the full local Alchemy graph.
[Testing standards](../reference/engineering/TESTING_AND_VERIFICATION.md) explain
which runtime to use for each kind of check. `python3 scripts/check-docs.py`
checks document links and record structure without application dependencies.

## Run the integrated browser journeys

Install Chromium and WebKit once, then run the page-object suite:

```sh
pnpm --filter @meal-planner/web exec playwright install chromium webkit
pnpm --filter @meal-planner/web test:e2e
```

Playwright invokes Alchemy’s actual Website Vite source provider and starts an
isolated Miniflare runtime on port 4398. It runs the compiled Website entry,
shared production API composition, D1
with real migrations, household SQLite Durable Objects, and the private-output
Worker. Each run uses temporary storage and deletes it on shutdown. No Cloudflare
credentials, deployment, external email, or AI provider are needed.

Run the standalone build and this suite sequentially in a checkout; building
while Miniflare watches client assets can restart the test server.

For a manual walkthrough of the full application, use `pnpm dev` above.
The focused fixture is started only by its test commands.
Test mail is captured at `/__test/mail?email=ENCODED_TEST_EMAIL`. This endpoint, `/__test/expire-session`, and
the test-client IP header exist only in the isolated fixture. The build script
calls Alchemy’s public source-provider API without evaluating the deployment
stack. Production and local builds share `website-source.ts`. Nitro handles the
standalone Node build and is disabled when Alchemy injects its Cloudflare plugin.

The suite covers signup, saved roster corrections, completion, invitation
acceptance, password reset, a creation response lost after commit, session expiry,
account changes across tabs, and competing edits. It also covers saved food-profile
correction and a fresh adult private review with a synthetic model, including
explicit confirmation, saved versions and closed earlier history. It runs in
desktop Chromium and mobile WebKit, with keyboard/focus checks and axe WCAG A/AA scans. The scan excludes
only Base UI’s hidden WebKit VoiceOver focus guards, an
[upstream expected behavior](https://github.com/mui/base-ui/issues/5237); it keeps
all rules enabled for app controls. This is not a full screen-reader audit.
Linked-account departures, real inbox delivery, live model quality, recipe-import browser journeys, and other product
flows need their separate environments and tests.

`pnpm --filter @meal-planner/web test` runs DOM tests in Vitest's Chromium browser
mode and pure tests in Node. Playwright journey failures retain traces under
`apps/web/test-results`; open one with `pnpm --filter @meal-planner/web exec
playwright show-trace PATH_TO_TRACE`. Traces can contain disposable account data
and tokens; review them before sharing.
