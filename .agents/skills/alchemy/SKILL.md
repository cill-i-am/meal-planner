---
name: alchemy
description: Change Alchemy v2 infrastructure, bindings, or deployment configuration.
---

# Alchemy v2

For a version-sensitive API, inspect the installed Alchemy/Effect versions,
stack entrypoint and relevant [source reference](references/doc-map.md). Preserve
the lockfile and patches unless an upgrade is in scope; do not upgrade merely
because an upstream example uses another version.

Alchemy is an Effect program with two related boundaries:

- `Alchemy.Stack(name, { providers, state }, effect)` is the deployable graph.
  Yield resources inside the Stack and return only safe, useful Outputs.
- A Function/Server constructor has a construction phase that runs during
  planning and at cold start, then returns request/event handlers for runtime.
  Construction must discover bindings and build services without doing request
  work.

Keep resource type, stack, stage, and logical IDs stable unless replacement is
intentional. Outputs are lazy graph references: pass them through props or use
Output combinators; do not interpolate, serialize, compare, or branch on them
as if they were resolved values.

Resolve `Config`/`Config.redacted` during construction so Alchemy can discover
and bind environment values. Keep `Redacted` values redacted through Outputs,
state, logs, and provider errors. In an async Worker, use `env` plus
`Cloudflare.InferEnv` rather than handwritten binding types.

Bindings are capability contracts plus an implementation Layer. Yield the
narrowest capability, provide its exact native or HTTP Layer once at the
platform boundary, and keep provider resources, credentials, and SDK clients
out of domain/public contracts. Prefer `Layer`-owned services when a feature
needs to carry resources and permissions together. Prefer native schemaless
RPC for trusted Worker/DO/Container calls; use Effect RPC or Effect HTTP when
data crosses a browser, partner, webhook, or other trust boundary. Typed RPC
still needs domain decoding/reconstruction at runtime boundaries.

Stages select isolated infrastructure; profiles select credentials. Current
upstream defaults are `live_$USER` for deploy/plan/destroy and `dev_$USER` for
`alchemy dev`; `Test.make` uses `test_$USER`. Pass `--stage` and `--profile`
explicitly for CI, production, previews, and any repository wrapper. Local
profiles are managed with `alchemy profile edit/show`; do not tell operators to
export Cloudflare credentials for local login. CI may use provider environment
credentials under its own resolver, after `provider check-env` and event/stage
guards.

Treat `Cloudflare.state()` bootstrap, deploy, destroy, adoption, credential or
token creation, state/profile clearing, and real-cloud tests as mutations of
their actual target. A plan is normally non-applying, but first use of remote
state can still bootstrap infrastructure. Resolve the actual target and effects
and use existing task authorization; do not ask again for the same authorized
operation. Preserve the repository wrapper's controls, including any rejection
of `--yes`. A command name does not establish that it is read-only.

Use the relevant provider guide and generated API page immediately before
writing unfamiliar props. A routine edit does not need a full workspace audit
or package upgrade. Inspect unfamiliar scripts before treating them as
read-only, and finish safe local checks before requesting any missing cloud
approval.

## References by task

- Resource graph and lifecycle: [core model](references/core-model.md), [Effect infrastructure](references/effect-infra.md).
- Provider configuration: [Cloudflare](references/cloudflare.md), [AWS](references/aws.md), [GitHub](references/github.md).
- Protocol and runtime boundaries: [APIs](references/apis.md).
- Commands and state: [CLI operations](references/cli-operations.md), [environments/auth/state](references/environments-auth-state.md).
- Local tests or integration proof: [testing](references/testing.md).
- Containers and builds: [toolchain](references/containers-toolchain.md).
- Database resources: [database patterns](references/database-patterns.md), with [Drizzle](references/drizzle.md), [Neon](references/neon.md), or [PlanetScale](references/planetscale.md) only when used.
- Stack ownership: [monorepos](references/monorepos.md).
- Custom provider work: [extensions](references/provider-extension.md).
- Operational investigation: [observability](references/observability.md), [gotchas](references/gotchas.md).
- Requested infrastructure audit or deployment review: [audit checklist](references/audit-checklist.md).

Verify the changed binding/runtime with relevant local proof and required checks.
A cloud plan is not mandatory evidence for an ordinary code edit.
