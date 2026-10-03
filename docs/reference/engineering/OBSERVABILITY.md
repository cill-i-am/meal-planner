# Observability

Use logs and traces to explain failures without exposing secrets. Keep logging outside pure domain decisions. Code that runs external operations can report their typed results.

## Core vocabulary

**Structured Tracing** — Correlated telemetry across requests, jobs, workflows, modules, adapters, and external calls.

**Safe Error Summary** — A diagnostic built from stable tags, operation names, dependency names, type names, or explicitly safe fields rather than arbitrary object serialization.

**Redacted Value** — A wrapper for secrets that prevents accidental logging, inspection, and JSON serialization.

**Safe Fields** — Telemetry fields that are intentionally non-secret: domain IDs, operation names, dependency names, state tags, retry counts, error tags, route names, and safe summaries.

## Current platform configuration

The owner requested full native Cloudflare tracing and invocation logs for the
prelaunch application on 3 October 2026, accepting automatic request URL metadata.
All Worker hosts use the shared `worker-observability.ts` configuration at 100%
sampling; the API and household hosts provide Alchemy's native Effect tracer.
This is an explicit exception for platform-generated request metadata to the
secret-free telemetry rule below. Application-authored logs and attributes still
use safe summaries and redacted credentials. Review platform metadata and sampling
before real-user onboarding. See [operation and pricing](../../how-to/operate-infrastructure.md#native-observability-and-shared-media-builds).

## Request outcomes and database spans

The API emits one structured completion event through Effect's JSON logger.
It includes request and native trace IDs, handler duration, HTTP status and safe
error categories. Import correlation starts with the same request ID and remains
explicit in durable payloads. Raw response/stream and WebSocket lifetime remain
owned by their native host; the event measures response handoff.

Use the native Drizzle tracer for ordinary D1 and synchronous Agents instances.
Effect-backed Drizzle already emits SQL spans through Effect and Alchemy's bridge.
Do not wrap lazy Effect queries with a synchronous/Promise-only span wrapper:
that measures construction and misses execution failures. Query parameters remain
excluded. Preserve typed failures and interruption when adding completion logging.

## Non-negotiables

- Secrets never enter errors, logs, traces, metrics, snapshots, panic summaries, test snapshots, or serialized diagnostics.
- Sensitive values are wrapped in a redacted value at the boundary and unwrapped only where the raw value is needed.
- Unknown thrown values and arbitrary payloads are not `JSON.stringify`'d for diagnostics.
- New External Adapter Modules and error translations preserve established tracing, logging, metrics, and error-reporting behavior.
- Domain decisions do not depend on a logger or telemetry mechanism.

## Apply this file

For each External Adapter Module, error translator, framework handler, workflow step or background task you change, check:

- secret redaction at the boundary;
- safe error summaries and safe telemetry fields;
- preservation of existing logs, traces, metrics, error reporting, and correlation hooks;
- no new telemetry dependency inside domain decisions.

If that path has no existing reporting or correlation mechanism, say so. Do not add an unrelated system as part of the edit.

## Strong defaults

- Use Effect's `Redacted.Redacted` in Effect codebases.
- Outside Effect, use a small local `Redacted<T>` wrapper, usually in `prelude.ts`, when the project lacks one.
- Prefer structured fields over prose-only logs.

## Redaction

Wrap secrets as soon as they cross the boundary:

```ts
type ApiConfig = {
  readonly endpoint: Url;
  readonly token: Redacted<string>;
};
```

Unwrap only at the adapter that needs the raw value:

```ts
await fetch(endpoint, {
  headers: { authorization: `Bearer ${Redacted.value(token)}` },
  signal,
});
```

Avoid carrying raw secret strings through Service Modules:

```ts
type ApiConfig = {
  readonly token: string; // easy to log, snapshot, or include in error context
};
```

## Safe error summaries

Prefer stable summaries:

```ts
logger.error("User lookup failed", {
  operation: "findActiveByEmail",
  provider: "postgres",
  errorTag: error._tag,
  userId: UserId.toTelemetryField(userId),
});
```

Avoid serializing arbitrary thrown values:

```ts
logger.error(`Unexpected failure: ${JSON.stringify(cause)}`);
```

If a panic helper needs context, pass an explicit safe summary:

```ts
shouldNeverHappen("Unhandled payment state", { stateTag: payment._tag });
```

Do not dump the whole domain object, request body, environment, or dependency response.

## Structured tracing

Good traces answer:

- What operation was running?
- Which dependency or adapter was involved?
- Which safe domain/resource IDs identify the work?
- Which state or transition was attempted?
- Which typed error tag occurred?
- Was this a retry, compensation, cancellation, or normal path?

Example fields:

```ts
{
  operation: "sendWelcomeEmail",
  dependency: "resend",
  userId,
  attempt,
  errorTag: result.error._tag,
}
```

Avoid uncorrelated logs that are only useful by reading source code:

```ts
logger.error("failed");
```

## Preserve existing observability

Before adding an External Adapter Module, error translator, framework handler, workflow step, or background task, inspect how the repo currently reports:

- logs;
- traces/spans;
- metrics;
- error reporting;
- request/job correlation;
- cancellation/interruption.

Do not bypass established hooks. If the existing system is exception-based, typed local failures can still be translated at the boundary while preserving the same reporting path.

The changed code should use the same reporting and correlation mechanisms as similar code. If none exist, record that limitation.

## Keep the core independent

Prefer:

```ts
const decision = Invoice.decideReminder(invoice, now);
logger.info("Reminder decision", InvoiceReminder.toTelemetryFields(decision));
```

Avoid:

```ts
function decideReminder(invoice: Invoice, logger: Logger) {
  logger.info("checking invoice");
  // domain behavior now depends on telemetry plumbing
}
```

Domain Modules may expose explicit telemetry projections for safe fields when useful, but they should not perform logging.

## Rejected framings

- **"It's just logs."** Logs and traces are production outputs and can leak secrets.
- **"More context is always better."** More raw context is often worse. Use safe summaries.
- **"The error message should include the payload."** Include stable tags and safe IDs, not payload dumps.
- **"Instrumentation belongs in domain logic."** Domain logic returns decisions; Service Modules and External Adapter Modules observe them.

## Review checklist

Check the relevant items below when reviewing a change. The sections above explain the rules.

- Including API keys, tokens, raw credentials, env values, or request bodies in thrown messages.
- Adding a new External Adapter Module that returns typed errors but skips existing error reporting.
- Logging `cause` directly without a safe summary/classifier.
- Forgetting retry count, operation name, dependency name, or typed error tag in failure telemetry.
- Using redaction only at log call sites instead of wrapping secrets at the boundary.

## Browser diagnostics

The production stack owns a hostname-specific Cloudflare RUM site. Set
`WEB_ANALYTICS_HOST` to the Website's actual hostname before deployment. The
Website embeds its public beacon token through Start loader data and preserves it
on client navigation. Local and preview stages omit the beacon and cloud resource.
Cloudflare measures page performance and SPA navigation independently of app logs.

The browser host reports API response handoff timing, HTTP/network/cancellation
outcomes, initial page and changed-path navigation, and uncaught JavaScript,
Promise and root React-boundary errors. Browser-only feature transports share the
same adapter. It preserves original responses, bodies, failures and cancellation.
WebSocket messages and streaming response completion are not measured by this
adapter. Errors handled by a feature remain that feature's responsibility.

A shared Effect HttpApi contract owns `/v1/browser-events` and its generated
client. Events contain fixed area, operation and error categories, durations,
status and optional API request IDs. Form values, URLs, query strings, messages,
stacks and transcript contents are excluded. Events are untrusted diagnostics,
not authenticated facts. The API receives them before opening auth/database
services, accepts only its request origin, caps decoded bodies at 4 KiB, and uses
Alchemy's native rate-limit binding at 60 requests per minute per connecting IP.
Cloudflare limits are approximate and local to a location, not a global quota.
The browser allows 30 events per minute; reporting failures are swallowed and
never retried. These best-effort events can be dropped by blockers or shutdown.

In Cloudflare Logs, filter for `browser.event`; join `browser.requestId` to the
API completion event's `requestId`. This is request correlation, not continuous
browser-to-Worker trace context propagation. RUM is free; telemetry ingestion
requests and their Worker logs/traces count toward the existing account usage.
