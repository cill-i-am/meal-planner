# Media acquisition container lifetime

Each import execution generation owns one container through its acquisition Durable
Object. Initialization binds the native container without starting it. Only an
admitted prepare, evidence preparation, or artifact fetch starts the container.
Cleanup, reader closure, alarms, and rejected replay never start it.

`acquireStoreVerify` installs generation cleanup before prepare or transport
decoding. Successful acquisition keeps the process alive through the original,
audio, and three frame uploads, their manifests, and R2 verification. The workflow
still permits 325 seconds of acquisition work and five seconds of caller cleanup.
Cleanup failure cannot change an already verified acquisition result.

## Reader ownership and retirement

Every private artifact fetch carries a fresh UUID reader token. Its close RPC uses
the same canonical artifact parser as fetch, including audio and frame suffixes.
The client registers closure before opening the response and acknowledges closure
before cancelling the native body transport. Close RPC failure remains visible.

The coordinator owns the source stream scope independently of downstream demand.
Native DO response cancellation does not reliably close a paused Effect producer.
A close acknowledgement waits for fetch setup to settle and for that source scope
to close before releasing its lease. Closing one reader does not release siblings.
Closed tokens are persisted, including close-before-fetch, so delayed requests and
reconstruction cannot reopen them.

Normal cleanup first persists retirement, refuses new work, drains admitted
operations and readers, then awaits native `destroy()`. The retired flag survives
DO reconstruction. Repeated cleanup is harmless and cannot restart the process.
The obsolete container artifact-delete RPC has been removed; destroying the
process removes its temporary workspace.

Each admitted operation arms a native DO alarm for 330 seconds after activity.
Body chunks and operation completion refresh activity; an early alarm reschedules
itself. Expiry persists retirement and signals cancellation. It allows up to one
second for terminal reader/setup joins, then awaits native destroy even when a
reader finalizer does not settle. Graceful cleanup keeps its full drain semantics.
The alarm is deleted only after destroy succeeds; failed destroy retains retirement
and alarm retry semantics.

This is an application-owned idle policy. The installed local workerd
`setInactivityTimeout` implementation retains a container reference for the given
interval; it does not directly implement an activity-resetting shutdown deadline.
It cannot establish the required local finite-lifetime proof by itself.

## Native R2 streaming

The application adapter uses Alchemy's public native R2 binding. It forwards the
length, checksum, metadata, and create-only condition to `raw.put` for bytes and
streams. Alchemy beta.76's streamed `WriteBucketBinding` path drops options when
calling `raw.put`, so that path cannot preserve this existing storage contract.

A streamed upload owns its fixed-length producer through completion or
cancellation. Early conditional rejection, put failure, and interruption signal
source cancellation, abort the pipe, cancel its native readable when available,
and join the producer. Cancelling only the pipe can leave a backpressured native
fixed-length write pending. This path has no private binding replacement or
compatibility fallback.

## Local verification

Run the native proof with Node 24.20.0, pnpm 12.3.4, and a running Docker engine:

```sh
MEAL_PLANNER_RUN_CONTAINER_TESTS=1 pnpm --filter @meal-planner/api exec vitest run \
  --disableConsoleIntercept --config vitest.container.config.ts \
  src/features/imports/import-media-lifecycle.integration.ts
```

The opt-in fixture uses installed Miniflare 5.20260903.0-alpha, workerd
1.20260903.1, the real Alchemy Durable Object bridge, the production coordinator,
production media runtime, and native R2. Only acquisition input and media process
outputs are synthetic. It builds a disposable Docker image from the pinned
production Node base and uses Miniflare's native container sidecar. Docker may
need to pull those public images. No provider account or cloud deployment is used.

The proof checks five 2 MiB streamed artifacts and two manifests; stored byte
hashes; an unchanged object after duplicate create-only upload; explicit process
removal; partial original/audio/frame cancellation; cleanup overlapping a full
reader; generation isolation; replay rejection; persisted closed tokens across
native eviction; and default idle shutdown. Process absence is asserted before
fixture teardown. The full idle check takes about six minutes.

Native eviction is verified for a retired generation and an open generation
before startup. The reconstructed open generation can start fresh work and later
expires under the default alarm policy. Active running reconstruction is not
claimed: installed Alchemy `StartContainer` forks a detached container monitor,
and Miniflare rejects active eviction with `Timed out waiting to evict Durable
Object: it still has active references.` No lifecycle patch or teardown is used
to work around that host limitation.

Focused lifetime tests cover setup/admission interruption, reader isolation,
retirement reconstruction, failed destroy, and non-settling finalizers. Workerd
R2 tests cover early conditional rejection and native producer cancellation;
acquisition tests cover prepare/decode failure and the existing cleanup budget.
