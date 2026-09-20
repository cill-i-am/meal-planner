# Testing and Verification

Test behavior through the same interfaces the application uses. Check results, saved data and visible effects rather than spying on private implementation details.

## Vocabulary

**Behavior Test** — A test that checks inputs and results through a public interface or a place designed to accept a substitute dependency.

**Real Seam Test** — A test that replaces behavior through an intentional production seam: constructor-injected dependency, Effect service/layer, local database, in-memory/fake adapter, or runtime-provided binding.

**Property Test** — A test that checks a general property across generated inputs rather than only examples.

**Arbitrary** — A Fast-Check generator for valid or intentionally invalid test values, preferably colocated with the domain module it supports.

**Risk-Matched Evidence** — Checks suited to the consequences of the change. They cover important rules, failures, boundaries, async behavior, storage and runtime assumptions, and user-visible results through public interfaces or a representative runtime.

## Non-negotiables

- Tests assert observable outcomes: returned values/failures, persisted state, emitted messages, rendered responses, sent fake-adapter records, or runtime effects.
- Tests do not depend on private helpers, internal call order, or incidental implementation structure when behavior can be tested through the interface.
- Do not use module-patching APIs such as `vi.mock`, `jest.mock`, or equivalents.
- Do not use method-spy APIs such as `vi.spyOn`, `jest.spyOn`, or equivalents.
- When replacing behavior, replace it through a real seam.
- Production External Adapter Modules are tested through the same service-facing interface callers use.
- Tests that make deterministic claims control time, randomness, IDs, external dependencies, and cancellation when those inputs affect the outcome.
- A test must fail when the claimed behavior is absent.

## Verification completion criterion

Verification is complete when the important behavior and risks affected by the change have suitable checks. Use public interfaces or a representative runtime to check rules, failures, boundaries, async behavior, storage assumptions and user-visible results. Do not add redundant tests or a release gate without a concrete reason.

If a representative environment is unavailable, name the unproven claim instead of presenting a lower-level test as proof.

## Strong defaults

- Prefer e2e tests for critical user flows.
- Prefer integration tests through real seams for External Adapter Modules and Service Module orchestration.
- Use focused behavior tests and property tests for pure Domain Modules.
- Use property tests for parsers, smart constructors, state machines, serialization round trips, normalization, idempotence, and lawful combinators when properties express the invariant better than examples.
- Colocate tests with the owning module using `.test.ts` / `.test.tsx` unless the repository has an established different layout.
- Use the repository's canonical test command. In Vite+ projects, run tests through `vp test` and import ordinary test APIs from `vite-plus/test` unless Effect-specific testing applies.
- In non-Effect Vitest property tests, use the project-standard Fast-Check integration such as `@fast-check/vitest`.
- In Effect projects, use `@effect/vitest` and Effect Schema-derived generation as described in [`EFFECT.md`](EFFECT.md).

## Behavior through interfaces

Prefer:

```ts
const result = await passwordReset.requestReset(email);

expect(result).toEqual(ok({ delivery: "queued" }));
expect(emailAdapter.sentEmails).toContainEqual({
  to: email,
  template: "reset",
});
```

The fake adapter uses the same dependency interface as the production adapter. Its recorded messages let the test check the result.

Avoid:

```ts
const sendSpy = vi.spyOn(emailProvider, "send");
await passwordReset.requestReset(email);
expect(sendSpy).toHaveBeenCalledWith(...);
```

Interaction assertions are acceptable only when the interaction is the observable behavior, and then a fake/recording adapter supplied through a seam should own the record.

## No module mocks

Avoid:

```ts
vi.mock("../send-email", () => ({ sendEmail: vi.fn() }));
```

Prefer explicit seams:

```ts
const emails = new RecordingEmails();
const passwordReset = new PasswordReset(users, emails, clock);
```

Module mocks replace hidden dependencies. That ties tests to file structure instead of an interface designed for a substitute dependency.

## Risk-matched evidence

Match evidence to risk:

- **Focused changes** verify changed behavior through the owning module interface.
- **Elevated changes** also verify affected external, persistence, concurrency, or runtime seams.
- **Critical/high-consequence flows** verify the end-to-end flow when a representative environment exists.

Do not add a test just because a line changed. Identify which important behavior, failure, boundary, async rule or runtime assumption needs checking. Choose the check that gives useful confidence without repeating other tests. If a representative environment is unavailable, state which claim remains unproven rather than pretending a lower-level test proves it.

## Domain behavior and properties

Parsers, smart constructors, transitions, and pure decisions need focused behavior tests. Use properties where the invariant is general:

```ts
it.prop("normalization is idempotent", [emailAddressArbitrary], (email) => {
  expect(EmailAddress.normalize(EmailAddress.normalize(email))).toEqual(
    EmailAddress.normalize(email)
  );
});
```

Generate valid test values through the production parsers, schemas or smart constructors, or derive generators from them. Do not bypass a rule just to make test data easier to create.

Generate invalid boundary inputs when testing rejection, but do not label them valid domain values.

## Persistence behavior

When correctness depends on SQL, schema constraints, transactions, migrations, or query semantics, use a representative local database.

For Drizzle persistence tests that do not depend on Cloudflare runtime semantics:

- use in-memory `better-sqlite3`;
- run the real Drizzle migrations before the suite;
- exercise the production External Adapter Module through its service-facing interface.

A hand-written in-memory fake is not proof of SQL/schema/transaction behavior.

When the claim depends on Cloudflare D1, Durable Objects, Agents, workerd serialization, bindings, or runtime behavior, use `@cloudflare/vitest-pool-workers` and the relevant local binding/runtime.

## Runtime behavior

Use representative runtimes for platform contracts:

- Cloudflare Workers APIs and generated `Env`;
- Durable Objects and Agents;
- D1, R2, KV, Queues, Workflows;
- service bindings, `ctx.exports`, WebSockets, alarms;
- runtime serialization/structured clone.

Node-only tests are not proof of workerd-specific behavior.

For Cloudflare runtime placement, bindings, and workerd-specific behavior, also load [`CLOUDFLARE_ARCHITECTURE.md`](CLOUDFLARE_ARCHITECTURE.md).

## Boundary and failure evidence

Changed parsers verify accepted and rejected shapes.

Changed projections verify intended consumer-facing output.

Changed codecs verify owned directions and round trips when both directions are owned.

Changed expected-failure, cancellation, retry, idempotency, or compensation paths are tested by observing semantic outcomes, not internal calls.

## Test integrity

Avoid:

- tests that only execute a path without assertions;
- returning `false` from a property callback without making the test fail;
- snapshots that do not encode stable semantics;
- retries that hide flakiness;
- mutable fixture state leaking through shared layers/resources.

## Rejected framings

- **"It's a unit test, so mocks are fine."** The seam matters more than the test label.
- **"We tested the private helper."** Callers use the module interface; tests should too.
- **"Coverage went up."** Coverage is not behavior evidence.
- **"A fake proves database behavior."** Fakes prove External Adapter Module contract behavior, not SQL semantics.
- **"Node tests cover Worker code."** Only when the behavior does not depend on workerd/runtime APIs.

## Review checklist

Check the relevant items below when reviewing a change. The sections above explain the rules.

- Exporting internals just to test them.
- Verifying interactions with spies instead of observing fake adapter records.
- Skipping rejected parser cases.
- Bypassing smart constructors in test factories.
- Not running real migrations in persistence tests.
- Claiming runtime-hop serialization works without running in the runtime.
- Forgetting to control clocks, random IDs, cancellation, or External Adapter Modules.
