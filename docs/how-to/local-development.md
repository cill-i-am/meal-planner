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
