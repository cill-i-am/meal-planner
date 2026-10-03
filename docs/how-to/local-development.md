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

For a manual walkthrough of the full application, use `pnpm dev` above.
The focused fixture is started only by its test commands.
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
