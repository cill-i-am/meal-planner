# Async and Workflows

For async work, define who starts it, who can cancel it and who handles failures. Make concurrency, retries, transactions and saved progress explicit. Accidental sequential waits and unhandled background work can break behavior, not just slow it down.

## Vocabulary

**Caller-Owned Cancellation Lifetime** — Lower-level modules accept and propagate the caller's `AbortSignal` instead of inventing hidden operation lifetimes.

**Cancellable Options** — A final options object such as `{ readonly signal?: AbortSignal }`, leaving room for timeout, retry, trace, and idempotency options.

**Floating Promise** — A promise created without being awaited, returned, collected by a concurrency primitive, or handed to explicit detached-work machinery.

**Detached Work** — Intentional background/post-response work owned by a runtime or project helper with lifetime, cancellation, rejection handling, and observability.

**Retry-Safe Command** — A mutating operation whose repeated execution after retry/redelivery/crash does not duplicate or contradict side effects.

**Atomic Transition Guard** — A persistence-level guarded update/transaction that applies a lifecycle transition only from legal prior states.

## Non-negotiables

- A received cancellation signal reaches every downstream cancellable operation.
- Lower-level modules do not replace the caller's cancellation lifetime with a hidden `AbortController` or timeout.
- New cancellable interfaces accept cancellation in a final options object, not positional signals or boolean flags.
- Await or return every promise, collect it with a concurrency helper, or give it to a runtime mechanism that manages background work.
- Background work must have an owner, a lifetime, a cancellation rule, error handling and a way to observe failures.
- Independent async work starts concurrently unless ordering/backpressure/rate limit/transaction/workflow/external contract requires serialization.
- User-sized, database-sized, file-sized, queue-sized, or otherwise unbounded collections use bounded concurrency.
- Retried mutating commands define how repeated execution avoids duplicate resources, transitions, messages, and external side effects.
- Retried create operations do not allocate a fresh logical identity.
- Do not hold database transactions open across network calls or long-running work.

## Cancellation

Async work that waits on I/O, timers, retries, queues, subprocesses, workflows, resource acquisition, or long computation should accept caller-owned cancellation when the runtime supports it.

Use **Cancellable Options**: a final options object that can grow without changing positional parameters.

```ts
type FindUserOptions = {
  readonly signal?: AbortSignal;
};

await users.findActiveByEmail(email, { signal });
```

Avoid positional or boolean cancellation:

```ts
findUser(email, signal);
findUser(email, true); // not cancellation
```

Propagate the signal:

```ts
await fetch(url, { signal });
await retry(operation, { signal });
await sleep(delay, { signal });
```

If a dependency cannot accept `AbortSignal`, check before and after the call and document the limitation:

```ts
signal?.throwIfAborted();
const result = dependency.call();
signal?.throwIfAborted();
```

Classify cancellation before wrapping unknown failures as ordinary dependency errors.

## Promise ownership

Prefer collecting created promises immediately. For small known-size collections:

```ts
await Promise.allSettled(items.map(processItem));
```

For user-sized, database-sized, file-sized, queue-sized, or otherwise unbounded collections, collect work through the shared bounded-concurrency primitive.

Avoid:

```ts
items.map(processItem); // floating promises
void sendEmail(user); // unowned detached work
```

Detached work goes through the runtime/project mechanism:

```ts
ctx.waitUntil(sendWelcomeEmail(user));
runDetached(sendWelcomeEmail(user), { signal, logger });
```

The mechanism must own rejection handling and observability.

## Concurrency

Avoid accidental sequential awaits:

```ts
for (const user of users) {
  await sendWelcomeEmail(user); // hidden waterfall unless serialization is required
}
```

Prefer starting independent work together:

```ts
const results = await Promise.allSettled(
  users.map((user) => sendWelcomeEmail(user, { signal }))
);
```

Use `Promise.all` only when the operations are one all-or-nothing dependency group and one rejection should reject the aggregate. `Promise.all` does not cancel peer work; pass cancellation through `AbortSignal` or a cancellable primitive when peers should stop.

Use `Promise.allSettled` when successes remain useful, failures need per-item reporting/classification, or peers should continue after one failure.

## Bounded concurrency

Small known-size collections can use `Promise.allSettled`. Unbounded or user/data-sized collections need an explicit limit chosen from the bottleneck:

- external API rate limit;
- database pool size;
- CPU cost;
- memory pressure;
- runtime/platform limits.

Prefer one shared primitive:

```ts
await mapConcurrentBounded(
  users,
  { concurrency: emailProviderConcurrency },
  sendEmail
);
```

Avoid magic limits:

```ts
await mapConcurrentBounded(users, { concurrency: 10 }, sendEmail);
```

To avoid overload, limit concurrency rather than making all operations sequential.

## Retry-safe commands

Treat mutating HTTP commands, especially `POST` creates, as retryable by default. Clients, proxies, Workers, queues, and humans retry after timeouts or lost responses.

A create operation must not allocate a fresh identity on retry and create a duplicate logical resource. Use one of:

- client/request idempotency key;
- client-provided natural ID plus unique constraint;
- persisted replay record;
- deduplication/inbox record;
- state-machine transition guard;
- transactional outbox/inbox.

Prefer:

```txt
receive CreatePayment(idempotencyKey)
  -> transaction: create/replay payment + outbox record
  -> deliver outbox after commit
```

Avoid:

```txt
insert payment
call payment provider
```

If the process crashes between saving data and making the external call, the result may be uncertain. Persist delivery progress so the system can recover without duplicating the action.

## Atomic transition guards

When a state change can race with another change or be retried, check the allowed starting state in the database operation:

```sql
UPDATE invoices
SET state = 'paid', paid_at = ?
WHERE id = ? AND state = 'sent'
```

Avoid stale read then unconditional write as the only guard:

```txt
row = SELECT invoice
if row.state == sent
  UPDATE invoice SET state = paid
```

Retries should not overwrite original transition metadata like `completedAt` or `paidAt`.

State whether repeating a delete is safe. If the result says this request deleted the entity, use the atomic delete result to decide that—not a read taken before the delete.

## Workflow selection

Use ordinary function calls or local database transactions for simple single-boundary operations.

An intent is a durable record of work that can continue after the request, as in the [recipe-import intent layer](../../../apps/api/src/features/imports/import-intent-transition.ts). Do not model an ordinary domain entity as an intent merely because its creation is asynchronous to the browser. A submitted create command can own server-side retry identity without adding a separate intent lifecycle.

Use a durable workflow, saga, or equivalent explicit orchestration record when a process needs:

- retries;
- compensation;
- idempotency;
- resumability;
- timers;
- human approval;
- cross-service coordination;
- multiple transaction boundaries.

Save the progress, retry information and recovery actions for durable multi-step work. Do not rely on the process staying in memory.

Do not introduce a workflow just for layering when ordinary calls/transactions are enough.

## Rejected framings

- **"Fire and forget."** Detached work still needs ownership.
- **"Sequential is safer."** Sequential loops hide latency and do not solve overload; use bounded concurrency.
- **"POST probably won't retry."** Retrying create commands is normal.
- **"We saved before calling the API."** Save-then-call still has a crash window.
- **"Timeouts belong everywhere."** Lower-level modules compose dependency-specific timeouts with caller cancellation; they do not replace it.

## Review checklist

Check the relevant items below when reviewing a change. The sections above explain the rules.

- Accepting `signal` at the top and dropping it before `fetch`, retry, sleep, or adapter calls.
- Using `Promise.all` for partial-failure batches.
- Awaiting inside loops over users/rows/files without documenting ordering or backpressure.
- Creating ad hoc pools/semaphores instead of the shared concurrency primitive.
- Retrying create operations with fresh server IDs.
- Holding transactions open while calling external services.
- Starting multi-step work with no persisted progress or compensation state.
