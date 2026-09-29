# Choose the local runtime

The repository has more than one way to run code locally. Check
[package.json](../../package.json), the [API scripts](../../apps/api/package.json)
and the [web scripts](../../apps/web/package.json) for the required versions and
commands. Install application tools with `pnpm install --frozen-lockfile` when
needed. Documentation checks need only Python 3.

## Local Tesco catalogue host

`pnpm dev` starts the API's Node host, not the full household web and Worker app.
The [API README](../../apps/api/README.md) lists the required shell settings.
The host uses Effect Config to read process environment variables; it does not
load `.env` files. Use authorized provider credentials and keep them out of records.

## Web and Cloudflare behavior

See the [web README](../../apps/web/README.md) for web entrypoints and the
[infrastructure guide](operate-infrastructure.md) for bindings, stages and local
runtime checks. Running the frontend alone does not test Worker routing, D1,
Durable Objects or private output. Use the existing native test configurations
when changing those parts.

Do not assume `alchemy dev` or `plan` is read-only or local. Setting up remote
state can change infrastructure. Inspect the wrapper and target before running it.
The live preview below runs the household web app with local storage and live
Workers AI. Other provider workflows still need their own runtime.

## Live family and planning agent

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

The separate `dev:auth-family` command below uses scripted model responses for
repeatable tests. Use `dev:preview` when trying your own chat messages.

After building the web Worker, verify the preview's service connections without
calling a model:

```sh
node --import tsx apps/api/src/test/local-preview-family.test-fixture.ts
```

This smoke runs on port 4498 with disposable local data. It checks signup,
family creation, creator linking, person creation and exact request replay,
then stops its runtime and removes its temporary data.

### Future Alchemy ownership

The installed Alchemy version exposes `Cloudflare.AI.Gateway`, including logging,
cache and spending-limit settings. The existing
[recipe import gateway](../../apps/api/src/infrastructure/import-provider-gateway.ts)
demonstrates this resource. A future deployment can declare a dedicated family
agent gateway and pass its ID with the model configuration through the
[conversation bindings](../../apps/api/src/features/agent-conversations/conversation-binding.ts).
Provider credentials remain in the credential store or runtime bindings.
Credit purchases remain an account billing operation. This local preview does
not apply that infrastructure; a fresh deployment still needs its own reviewed
Alchemy target, stage and profile.

## Verification

Run the relevant package checks and required CI checks. Root commands are
`pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm build`.
Use `pnpm test:container` for synthetic media tests.
[Testing standards](../reference/engineering/TESTING_AND_VERIFICATION.md) explain
which runtime to use for each kind of check. `python3 scripts/check-docs.py`
checks document links and record structure without application dependencies.

## Run the auth and family reference journey

Install Chromium and WebKit once, then run the page-object suite:

```sh
pnpm --filter @meal-planner/web exec playwright install chromium webkit
pnpm --filter @meal-planner/web test:e2e
```

Playwright invokes Alchemy’s actual Website Vite source provider and starts an
isolated Miniflare runtime on port 4398. It runs the compiled Website entry,
shared production auth/family API composition, D1
with real migrations, household SQLite Durable Objects, and the private-output
Worker. Each run uses temporary storage and deletes it on shutdown. No Cloudflare
credentials, deployment, external email, or AI provider are needed.

Run the standalone build and this suite sequentially in a checkout; building
while Miniflare watches client assets can restart the test server.

For a manual walkthrough, run `pnpm --filter @meal-planner/web dev:auth-family`
and open `http://127.0.0.1:4398/signup`. Stop the process with Ctrl+C when finished.
Test mail is captured at `/__test/mail?email=ENCODED_TEST_EMAIL`. This endpoint, `/__test/expire-session`, and
the test-client IP header exist only in the isolated fixture. The build script
calls Alchemy’s public source-provider API without evaluating the deployment
stack. Production and local builds share `website-source.ts`. Nitro handles the
standalone Node build and is disabled when Alchemy injects its Cloudflare plugin.

The suite covers signup, saved roster corrections, completion, invitation
acceptance, password reset, a creation response lost after commit, session expiry,
account changes across tabs, and competing edits. It runs in desktop Chromium and
mobile WebKit, with keyboard/focus checks and axe WCAG A/AA scans. The scan excludes
only Base UI’s hidden WebKit VoiceOver focus guards, an
[upstream expected behavior](https://github.com/mui/base-ui/issues/5237); it keeps
all rules enabled for app controls. This is not a full screen-reader audit. It stops at
the post-setup boundary. Linked-account departures, real email delivery, and the
rest of the product need their separate environments and tests.

`pnpm --filter @meal-planner/web test` runs DOM tests in Vitest's Chromium browser
mode and pure tests in Node. Playwright journey failures retain traces under
`apps/web/test-results`; open one with `pnpm --filter @meal-planner/web exec
playwright show-trace PATH_TO_TRACE`. Traces can contain disposable account data
and tokens; review them before sharing.
