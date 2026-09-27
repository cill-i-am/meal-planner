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
This guide does not claim that the repository has a single command to start the
complete product.

## Verification

Run the relevant package checks and required CI checks. Root commands are
`pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm build`.
Use `pnpm test:container` for synthetic media tests.
[Testing standards](../reference/engineering/TESTING_AND_VERIFICATION.md) explain
which runtime to use for each kind of check. `python3 scripts/check-docs.py`
checks document links and record structure without application dependencies.

## Run the auth and family reference journey

Install Chromium once, then run the page-object suite:

```sh
pnpm --filter @meal-planner/web exec playwright install chromium
pnpm --filter @meal-planner/web test:e2e
```

Playwright builds Cloudflare-targeted SSR and starts an isolated Miniflare runtime
on port 4398. It runs the Website handler, scoped production API handlers, D1
with real migrations, household SQLite Durable Objects, and the private-output
Worker. Each run uses temporary storage and deletes it on shutdown. No Cloudflare
credentials, deployment, external email, or AI provider are needed.

For a manual walkthrough, run `pnpm --filter @meal-planner/web dev:auth-family`
and open `http://127.0.0.1:4398/signup`. Stop the process with Ctrl+C when finished.
Test mail is captured at `/__test/mail?email=ENCODED_TEST_EMAIL`. This endpoint and
the test-client IP header exist only in the isolated fixture. The normal Alchemy
Website build keeps its own Cloudflare Vite integration; the test build explicitly
selects Nitro's `cloudflare-module` preset instead of its standalone Node default.
Both entries use the production Website handler.

The suite covers signup, saved roster corrections, completion, invitation
acceptance, password reset, and a creation response lost after commit. It stops at
the post-setup boundary. Linked-account departures, real email delivery, and the
rest of the product need their separate environments and tests.

`pnpm --filter @meal-planner/web test` runs DOM tests in Vitest's Chromium browser
mode and pure tests in Node. Playwright journey failures retain traces under
`apps/web/test-results`; open one with `pnpm --filter @meal-planner/web exec
playwright show-trace PATH_TO_TRACE`. Traces can contain disposable account data
and tokens; review them before sharing.
