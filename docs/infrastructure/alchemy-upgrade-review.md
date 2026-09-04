# Alchemy upgrade and Cloudflare efficiency review

Reviewed 4 September 2026 against fetched `origin/main` at
`9a59f85170f379e065920eadaaf69593d90c2c40`. This is a source and local-runtime
review, not an account-usage or billing audit. No Cloudflare resources were
planned, deployed, or changed.

## Upgrade delivered

Alchemy moves from `2.0.0-beta.72` to `2.0.0-beta.76`, the npm `latest` tag
at review time. `next` still pointed to `.72`; selecting it would not upgrade
this repository. Effect, platform-node, and Effect Vitest move together to
`4.0.0-rc.112`, with `mysql2` aligned to Alchemy's peer requirement.
The [official getting-started guide](https://alchemy.run/getting-started/)
now installs `alchemy@latest`.

The two D1 declarations use `.76`'s `migrations: { dir, table }` API with
unchanged logical resource IDs, migration directories, and `d1_migrations`
tracking-table names. Upstream now converts the old three-column ledger to
its five-column format. That conversion is a database mutation at the next
approved D1 reconciliation. An unchanged resource may remain a deployment
no-op: Alchemy compares migration hashes and the tracking-table name, which
this upgrade preserves.
Local tests exercise conversion and replay; actual deployed histories have
not been inspected.

The custom 84-line NodeNext source loader is deleted. The command wrapper
uses the already-pinned `tsx` through Node's `--import tsx`. A real Alchemy
CLI plan of an in-memory fixture resolves the repository's `.js`-to-`.ts`
imports without the loader. The stage/profile and approval guards remain.

## Remaining shims and their removal conditions

| Area | Why it remains on `.76` | Removal proof |
| --- | --- | --- |
| D1 migration transport | Upstream's cloud executor submits compound SQL through the query endpoint. The retained patch sends each registry batch through D1 import, keeping triggers and migration ledger writes together. It adopts the new registry instead of preserving the old migration implementation. | Unpatched upstream passes checked-in auth/accounting migrations, trigger execution, failure rollback, ledger conversion, and replay tests. |
| Queue consumer reconciliation | Output-backed DLQs, settings drift, readback convergence, and narrowly guarded missing-DLQ recovery are still absent or incomplete upstream. | Run the existing Queue regression suite against an unpatched release; include backlog and ownership guards, not just successful creation. |
| Worker metadata hashing | Provider bookkeeping and unresolved binding data can still cause unstable or incorrect hashes. | Unpatched upstream passes metadata and resolved-binding regression suites, including meaningful configuration changes. |
| Nine vendor type exceptions | AI model/body correlation and generated Workflow/Durable Object host signatures still have the same upstream type gaps. | A supported precise public transport/host generic replaces each exception without casts or changing the AI protocol. |

The provider patch is still substantial. Moving it into application wrappers
would relocate the maintenance burden. Keep one exact-version patch and its
behavioral regressions; remove each section when upstream independently
passes its tests. A focused upstream contribution per defect would make
future upgrades cheaper, but none was published as part of this review.

## Highest-value Cloudflare opportunities

### 1. Bound the media container's running lifetime

[`import-media-container.runtime.ts`](../../apps/api/src/features/imports/import-media-container.runtime.ts)
configures `standard-1` and `maxInstances: 2`.
[`import-media-acquisition-object.ts`](../../apps/api/src/features/imports/import-media-acquisition-object.ts)
uses the Alchemy Containers layer; cleanup removes artifacts, but the
application does not set an inactivity timeout or destroy the container.
Alchemy `.76` exposes both operations. This is a missing explicit lifecycle
bound, not proof that two containers currently run continuously.

Add an idle timeout around acquisition and private artifact transfer, with
explicit shutdown after all required artifacts are durably copied and no
reader remains. Verify slow transfers, restart, cancellation, cleanup failure,
and generation replay before deploying. Stopping immediately after media
extraction could destroy files before R2 receives them.

Cloudflare charges running containers for provisioned memory/disk and actual
CPU. `standard-1` provisions 4 GiB and 8 GB: memory plus disk is approximately
**$0.038/hour per running instance**, before included allowances and CPU.
Two instances running for a hypothetical 720-hour month produce **$54.74**
in gross memory/disk charges. This is an exposure illustration, not estimated
current spend. [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/)

Then benchmark `basic` against `standard-1` using representative video and
carousel fixtures. Its smaller memory/disk allocation costs roughly 74% less
per running hour, but lower CPU and memory can increase duration or cause
failures. Measure peak RSS, wall time, failures, and total cost per successful
import before selecting it. [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/)

### 2. Separate delivery recovery from rapid resending

[`household-import-batch.repository.ts`](../../apps/api/src/features/households/batches/household-import-batch.repository.ts)
schedules the next outbox attempt five seconds after both successful and
failed sends, until the batch item settles. The item Workflow handles
admission and dispatch; this interval does not necessarily span the whole
media import. A delayed item can nevertheless cause repeated Queue messages,
Workflow-start reconciliation, alarms, and persistence work.

Use bounded backoff for uncertain sends and a longer recovery deadline after
confirmed delivery/start. Preserve deterministic Workflow IDs, canonical
household settlement, lost-ack recovery, and `outcomeUnknown` behavior. Measure
messages and alarms per settled item, and test Queue loss, delayed consumption,
and restart before changing the interval. This is a stronger simplification
candidate than deleting the outbox or Queue.

### 3. Keep the existing private Worker and storage boundaries

The website → API → household-domain Worker split encodes authentication and
household authority. Under Workers Standard pricing, service-binding calls
do not add request charges; CPU is counted across the chain. Merging these
Workers would therefore not remove three request fees. Optimize measured CPU
or repeated calls if needed, while keeping the authority boundary.
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

Keep household state in SQLite Durable Objects, Better Auth in its own D1,
provider accounting in its operational D1, and short-lived evidence in R2.
Combining these stores would broaden coupling and undo explicit product
boundaries. The existing seven-day R2 lifecycle already limits evidence
retention; no billing evidence supports shortening it further.

### 4. Measure Workflow steps and logs before optimizing their allowances

Workflow steps/storage billing is active as of August 2026. The paid allowance
includes 500,000 steps/month; additional steps cost $0.80 per 100,000. Below
that allowance, collapsing steps may save nothing and weaken durable retry
boundaries. Keep provider dispatch/receipt checkpoints. Consider fewer trivial
steps or shorter terminal retention only after measuring usage and proving
recovery and reconciliation no longer need the retained instance.
[Workflow pricing](https://developers.cloudflare.com/workflows/reference/pricing/)

Worker logs currently use full sampling with invocation logs disabled. Paid
Workers includes 20 million log events/month; extra events cost $0.60/million.
Target noisy success events if actual volume warrants it, preserving error
and accounting evidence. This is lower priority than container lifetime.
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## Alchemy layout and delivery efficiency

- Keep one stack and feature-owned resources. Stable resource IDs and inferred
  bindings are valuable; a generic infrastructure abstraction would add another
  interface to maintain. Do not replace the working Website/Vite setup merely
  because `.76` adds more framework integrations.
- Resolve AI Gateway stage ownership before preview automation. Its explicit
  physical ID is `meal-planner-recipe-import`, unlike stage-derived resource
  names. Either stage-scope that physical ID or deliberately manage it as one
  shared account resource. Verify existing ownership first; renaming it can
  change provider configuration and budget behavior.
- Keep cloud-free loader and provider regression tests as the fast upgrade
  lane. Run it against unpatched candidates first, then retain only proven
  patch sections. A real stack plan can bootstrap account-wide Alchemy state,
  so it is not a harmless dependency check.
- Consider path-sensitive execution of the expensive synthetic container CI
  job, while retaining an always-reporting required check. Trigger it for the
  container runtime, acquisition/artifact paths, fixtures, CI definition, and
  dependency changes; document-only changes need no image build. Keep ordinary
  quality checks universal.

Recommended order: container lifecycle, batch delivery recovery intervals,
container sizing benchmark, then usage-driven Workflow/log tuning. These are
follow-up opportunities; this upgrade does not silently change recovery,
retention, resource identities, or cloud spending controls.
