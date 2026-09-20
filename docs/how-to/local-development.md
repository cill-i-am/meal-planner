# Choose the local runtime

Read the root [manifest](../../package.json), [API scripts](../../apps/api/package.json)
and [web scripts](../../apps/web/package.json) for required versions and exact
commands. Install the pinned dependencies with `pnpm install --frozen-lockfile`
when the task needs application tools; documentation checks need only Python 3.

## Local Tesco catalogue host

`pnpm dev` starts the API's Node host. It is not the full household web/Worker
application. Its [API README](../../apps/api/README.md) lists required shell
configuration. The host reads Effect Config from the process environment, not
`.env` files. Use only approved provider credentials and keep them out of records.

## Web and Cloudflare behavior

Use the [web workspace](../../apps/web/README.md) for its entrypoints and the
[infrastructure procedure](operate-infrastructure.md) for actual bindings,
stages and native local proof. A frontend-only dev server does not prove routed
Worker, D1, Durable Object or private-output behavior. Follow the existing
native test configurations for those seams.

Do not infer that `alchemy dev` or `plan` is local/read-only: remote state setup
can have effects. Inspect the repository wrapper and target before executing.
This guide does not invent a one-command full-product bootstrap that has not
been established by the repository.

## Verification

Use focused package tests/checks for the changed contract, plus repository-required
CI. Root commands are `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`
and `pnpm build`; synthetic media verification is `pnpm test:container`.
[Testing standards](../reference/engineering/TESTING_AND_VERIFICATION.md) explain
which runtime is evidence for which claim. `python3 scripts/check-docs.py` checks
document links and record structure without installing application dependencies.
