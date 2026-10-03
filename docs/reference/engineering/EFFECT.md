# Effect

Status: **Work in progress**.

This page records the agreed Effect rules. Follow these and the relevant local conventions; do not invent more style rules.

Load this file when changed behavior is already organized around Effect or uses Effect-specific semantics: Services, Tags, Layers, typed error channels, Schema, Redacted values, Effect-aware tests, Schema-derived generation, scoped resources, or established Effect RPC.

## Non-negotiables

- A responsibility already organized around Effect continues using the established Effect mechanisms for dependency provision, schemas, and Effect-aware testing.
- Do not introduce parallel constructor-injection, schema, or testing architecture inside an Effect responsibility without a concrete interoperability need or explicit architectural rationale.
- Dependency-bearing modules in Effect architecture use Effect Services/Tags/Layers rather than ad hoc dependency bags.
- Expected failures in Effect-based modules use Effect's typed error channel.
- Effect custom errors use the repository's established Effect tagged-error mechanism, such as `Schema.TaggedError`.
- When Effect is the established schema model, use Effect Schema for refined values and schema-derived domain construction.
- Sensitive values use Effect's Redacted value type in Effect codebases.
- Layers that construct cleanup-requiring resources own acquisition and cleanup.
- Effect-specific version assumptions are checked against installed versions before applying version-specific examples.

## Adoption boundary

Do not require code to adopt Effect just because it follows these standards. The general rules still apply: typed failures, input parsing, useful module interfaces, tests through real dependency interfaces, cancellation, logging and precise TypeScript types.

When a local responsibility is Effect-based, preserve the local Effect style unless it violates a settled standard here.

## Services and Layers

Use Services/Tags/Layers for dependency-bearing modules. Layers or the application composition root own construction, configuration, and resource wiring.

Domain operations should not construct production Layers as part of ordinary business behavior.

Prefer:

```txt
Service layer composition
  -> provide UserStore, EmailProvider, Clock, Config
  -> run service effects
```

Avoid:

```txt
Domain operation
  -> reads env
  -> constructs live database layer
  -> performs business decision
```

Parse raw configuration at the boundary or composition root. Keep related behavior together and define useful dependency interfaces.

## Typed errors

Expected failures belong in Effect's typed error channel. Do not convert ordinary domain, parse, authorization, dependency, persistence, or workflow failures into unchecked defects merely because an Effect can die.

Use the local established tagged-error mechanism:

```ts
class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  {
    userId: UserIdSchema,
  }
) {}
```

Keep error unions precise at module boundaries. Broad app-level failures belong near orchestration, rendering, logging, and entrypoints.

## Schema and parsing

When Effect Schema is established, use it for:

- boundary parsing;
- refined/branded domain values;
- codecs for runtime boundaries;
- schema-derived generated values in tests.

A successful schema parse should produce the refined value that flows inward. Do not parse and then keep using the unrefined input.

When a runtime boundary requires a codec/projection and Effect owns both sides or the local adapter, use Effect Schema codecs.

General boundary rules still apply: serialized input is untrusted, storage rows are parsed at the External Adapter Module seam, and receiving sides parse/reconstruct payloads before invoking service logic.

## Redacted values

Use Effect's Redacted value type for tokens, credentials, API keys, passwords, and secrets.

Wrap secrets at the boundary and unwrap only inside the adapter that needs the raw value. Observability rules still own no-leak behavior and safe summaries.

## Resource lifecycle

Layers that acquire resources also release them. Keep resource acquisition/cleanup in Layers or composition roots, not scattered through domain operations.

Shared/scoped Layers in tests must preserve managed teardown and must not leak mutable fixture state between tests.

## Effect RPC

If a codebase already uses Effect RPC, use its schema and transport model consistently for applicable typed RPC seams.

This work-in-progress standard does not require adopting Effect RPC where another established RPC model exists.

## Testing

The runtime uses `effect@4.0.0`. Effect's stable exports include `effect/http`,
`effect/http-api`, and `effect/ai`; Config constructors are capitalized.

Use stable `@effect/vitest@4.0.0` with Vitest `5.0.3` for Effect-aware
tests. Native Cloudflare Worker tests run in `tools/worker-tests`, which owns
the Cloudflare plugin and its supported Vitest `4.1.11`. The canonical
recursive test command runs both workspaces.

Effect 4 stable owns property generation through `effect/Arbitrary`. It no
longer re-exports Fast-Check from `effect/testing`.

Alchemy beta.80 treats Workflow callback defects and interruptions as terminal.
Keep recoverable remote failures in the typed error channel at native task
boundaries. Do not use `Effect.orDie` to request a retry. Native recovery tests
must assert terminal defects before explicitly restarting the failed step and
checking that durable replay does not duplicate work.

Use the repository's canonical test command. In Vite+ projects, still run tests through `vp test`. If the package manager requires an explicit `vitest` peer for `@effect/vitest`, pin it to the exact Vitest version bundled by the installed Vite+ version.

Prefer Effect-aware tests and test services:

- `it.effect` for effects under Effect test services;
- `it.live` only when the test intentionally verifies live runtime behavior;
- `layer(...)` / nested `it.layer(...)` for service tests with managed teardown;
- `Arbitrary.checkEffect` with schema-derived values for properties, asserting its returned result.

Property callbacks must assert or return a failing Effect when false. The
retained test adapter treats a successful Effect containing `false` as success.

## Schema-derived generation

Effect Schema is the default source of valid generated domain values.
Use `Arbitrary.schema(schema)` rather than maintaining a duplicate generator.
`Arbitrary.checkEffect` checks a property with bounded runs and a reproducible
seed. Assert that its result is `Passed`; merely running it does not fail a test.
`Arbitrary.formatCheckFailure` supplies shrinking and replay diagnostics.

`TestSchema.Asserts` from `effect/testing` also checks schema generation and
round trips. Check installed declarations before using version-sensitive
property helpers in `@effect/vitest`.

## Cloudflare + Effect

For a new Cloudflare project selecting Effect, or an Effect project selecting a new Cloudflare resource/config/deployment model, use Alchemy V2 for that modeling.

Do not duplicate Alchemy-owned declarations in ad hoc Wrangler configuration, one-off scripts, or parallel infrastructure models unless a documented tooling gap requires small compatibility glue.

Cloudflare platform placement itself lives in `CLOUDFLARE_ARCHITECTURE.md`.

## Rejected framings

- **"Effect is present somewhere, so all new code must use Effect."** Only use this file for responsibilities that depend on Effect-specific semantics or established Effect architecture.
- **"Effect lets failures die."** Expected failures stay in the typed error channel.
- **"Any Layer shape is fine."** Follow local conventions and keep resource ownership explicit.
- **"Property APIs are unchanged across releases."** Use the installed Effect Arbitrary and test adapter contracts.
- **"Version-specific examples are universal."** Check installed versions before applying beta-version guidance.

## Known gaps for future grilling

This file intentionally does not settle:

- canonical Service and Tag declaration forms;
- Layer granularity and composition conventions;
- expression composition and pipeline style;
- runtime ownership outside entrypoints;
- native fiber interruption conventions, beyond general cancellation propagation and cancellation classification;
- schedules, retries, timeout composition, and batching idioms beyond general async standards;
- stream architecture;
- transaction integration;
- Effect RPC adoption criteria;
- observability integration details.
