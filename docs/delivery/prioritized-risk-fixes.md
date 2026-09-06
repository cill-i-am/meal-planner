# Prioritized fixes after the dependency upgrade

- Recorded: 2026-09-06, from the user's explicit priority instruction.
- Status: complete in the authorized order: private output (#211), D1 release safety (#210), then media lifetime (#212). All three merged after independent review and hosted CI.
- Delivery ownership: one source owner per fix; technical advisers and
  independent reviewers are read-only.
- Verified continuation base: dependency-upgrade [PR 209](https://github.com/cill-i-am/meal-planner/pull/209)
  merged as `4b4e7fd651d66c2a03805eb00209c40fe3eb3240`. The fetched remote main
  matched this SHA when the implementation worktree was created. Its
  [verification record](../infrastructure/dependency-upgrade-2026-09-05.md)
  owns the upgrade evidence. Implementation and repository delivery are authorized
  under the [execution policy](../agents/execution-policy.md).

The fixes merged in the following order after their own implementation review and
verification. This order
supersedes the older efficiency-review recommendation. Broader Stage 2, chat UI,
models/providers, container sizing, outbox tuning, and other cost work remain
outside this queue.

## 1. Prevent private output after authority changes

**Merged first in PR #211 as `62adde277db478e91d2cf2c5d1efc54d90a2e76c` after independent review and hosted CI.** The production
Better Auth → API → HouseholdObject → isolated private-output composition now
uses real D1 and native WebSockets. The [implementation evidence](private-output-safety.md)
owns the exact scope, runtime cases, and recovery limits. No prior production
private-output leak was established: this closes the first-composition integration
gate left by the [Stage 1 SDK boundary evidence](stages/01-household-people/04-agents-boundary-evidence.md).

The pinned SDK's sub-agent output uses an asynchronous parent bridge, and its
inherited SQL/state RPC can expose a private Agent's storage. The accepted
[ADR-0004 fallback](../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md)
therefore uses a plain native child Durable Object as the physical emitter.
`HouseholdAgent` and the account lifecycle coordinator own revocation metadata
only. Private HTTP bodies, transcript-returning RPC, SDK client protocols, models,
chat UI, and Household grants remain disabled or absent.

Acceptance requires an explicit authority-change/output ordering design and real
runtime evidence:

- Copied references, another adult, and another household cannot access output.
- Membership/session revocation and person unlink/archive/rebind after admission
  stop passive socket output without requiring another inbound message. Delayed
  HTTP/WS results, queued output, and reconnect cannot release the private sentinel.
- Initial identity/state, state updates/broadcasts, enabled callable/streaming RPC,
  server push/replay, direct sub-agent/internal RPC, and parent access obey the same
  authority. Disabled paths receive negative proof without enabling extra features.
- An explicit output/revocation linearization point must match the canonical
  authority change. Caller acknowledgment must not postpone this boundary after
  membership or link revocation is already visible. Force canonical revocation
  between a successful authority read and output enqueue, including lost
  acknowledgments. This does not claim control over bytes emitted before that point.
  Authority-read failure and restart fail closed; hibernation cannot revive cached
  admission. Rechecks, push notifications, or polling alone do not close this race.
  Keep unsupported transports disabled if public SDK APIs cannot meet the contract.

## 2. Make the next D1 reconciliation safe

**Merged second in PR #210 as `570dad6a4c021c153e2155ba32eef10b1bbba9d6` after independent review and hosted CI.**
[PR #210](https://github.com/cill-i-am/meal-planner/pull/210) requires fresh target,
executor-state, ledger, schema and recovery-bookmark inspection before the release
wrapper starts Alchemy. Its D1 implementation head
`b9128b58b132ca7ffa5592302c43786be576fa1f` passed independent review, both hosted
CI jobs and 65 focused local tests. Combined candidate
`c6218d1d90fe3fee6cd62d8fe177ffa3429a4ed9` passed all 180 root infrastructure and
architecture tests, infrastructure typecheck, focused lint/format, frozen install
and the scoped independent review. Its first combined CI run passed D1 tests but
exposed API fixture timing races. The test-only correction
`1cfaf36ed343204802c78a2db4bc9c17501c231b` passed independent review and all 80
affected native cases in 43.42 seconds; D1 implementation code is unchanged.
[Final combined CI](https://github.com/cill-i-am/meal-planner/actions/runs/34023384616)
passed both Quality and Synthetic media container checks on that corrected head.
The merge tree `4c9969ff1130375e8cc79099f47c7d8579db0113` matches the reviewed
and tested correction head.

[PR #211](https://github.com/cill-i-am/meal-planner/pull/211) merged as
`62adde277db478e91d2cf2c5d1efc54d90a2e76c` before PR #210, preserving the
authorized merge order.
This is repository implementation evidence, not verification of a deployed D1
target or authorization to reconcile it.

Alchemy beta 76 can convert `d1_migrations` during an approved
D1 reconciliation; an unchanged resource may remain a deployment no-op. Deployed
histories are uninspected. The exact-version transport patch remains required;
[the Alchemy review](../infrastructure/alchemy-upgrade-review.md) owns its removal
criteria and [the infrastructure guide](../infrastructure/alchemy.md) owns target
selection and bootstrap gates.

For both `MealPlannerAuthDatabase` and `ProviderAccountingDatabase`, identify the
release SHA, stage, Alchemy profile, independently resolved account, and physical
database name/UUID before ledger inspection. Account resource discovery may
establish this mapping first; freeze it before inspecting either ledger. Map the deployed ledger shape and
history to checked-in SQL and enumerate pending migrations. Do not infer a target
from logical resource IDs or assume that stored names prove SQL hash identity.

Acceptance requires target-specific evidence and recovery readiness:

- Explain the actual three-column-to-five-column conversion, including hashes
  derived from release files, preserved names/timestamps, changed numeric IDs, and
  hard failure when a historical SQL file is missing.
- Prove conversion/replay and pending-migration failure handling. Conversion is a
  separate import batch before pending migrations; a later failure can leave the
  conversion committed. Existing mocked-HTTP/local SQLite tests are not remote D1
  transaction proof.
- Before approved reconciliation, record recovery bookmark/backup readiness and
  the exact conversion effect. Afterwards verify ledger, schema, and replay on
  both targets. Retain the patch until unpatched upstream satisfies its existing
  auth/accounting, trigger, rollback, conversion, and replay acceptance criteria.

## 3. Bound media-container running lifetime

**Merged third in [PR #212](https://github.com/cill-i-am/meal-planner/pull/212) as `3114e448f8deb78833e90371ce266a63d779ab44` at 09:30:32 UTC on 2026-09-06.**
The final reviewed head `4275f1144e1b6033f274223d8da3ee1570601da0` and merge
share tree `06425e2bb715ca7bf50ed786c9d0f40d6f31d802`. Independent review passed
the whole implementation at `271891f9059d44d105f42c1422b0dc555b9b5ef7`, the
combined D1/private integration at `e1f96246cb3a617463eb863bb44fb9466910cf0e`,
and the final test-only fixture correction. That correction explicitly pulls and
configures a pinned Miniflare Docker networking image after CI exposed its absence;
production container behavior is unchanged. Combined type checks, lint/format,
180 infrastructure/architecture tests, 32 focused Node tests and 27 workerd tests
passed; the adopted API fixture correction passed all 80 affected native cases.

Full local production-runtime Docker, Durable Object and R2 proof on the final head
passed in 360.16 seconds. Five streamed artifact hashes, create-only preservation,
original/audio/frame cancellation, overlapping reader drain, generation isolation,
replay and idle shutdown passed. Both abandoned generations retired before fixture
teardown; the independent Docker process receipt was empty at 350,701 ms.
[Final hosted CI](https://github.com/cill-i-am/meal-planner/actions/runs/34024207687)
passed Quality at 09:27:59 UTC and Synthetic media container at 09:29:27 UTC:
1,192 tests passed in Quality and both native container tests passed in 706.15
seconds. The hosted idle receipt independently showed no Docker processes before
teardown at 345,534 ms. [The lifetime record](../infrastructure/media-container-lifetime.md)
owns the behavior and native eviction limits; active-running reconstruction is
not claimed.

Artifact cleanup alone does not establish container shutdown. The
[existing review](../infrastructure/alchemy-upgrade-review.md) identifies the
missing application lifetime bound; it does not prove containers run continuously.

Use the generation-scoped acquisition object as lifecycle owner, with finite idle
fallback and explicit shutdown after original and derived artifacts are durably
copied to R2 and all response bodies have completed, cancelled, or errored. Shutdown
must cover unsuccessful preparation, cancellation, interruption, and cleanup failure
as well as success.
Do not stop at extraction/prepare completion, race new readers during drain, or
restart a stopped container solely to clean it. Keep sizing and benchmarking out
of this fix.

Acceptance must exercise the real container lifecycle through the acquisition
boundary: slow original/audio/frame transfers, reader drain, failed or malformed
preparation, cancellation, failed/nonsettling cleanup, restart, concurrent release,
and late generation commands. Preserve the existing execution/cleanup budgets and
create-only R2 recovery; eager startup and RPC auto-restart must not leave a retired
generation running. Prove idle shutdown for an abandoned caller and reapply its
finite timeout after restart. Idle timeout is not an absolute wall-clock cap under
ongoing activity.

Use a supported local Docker/DO application-runtime exercise with synthetic media,
real private artifact fetches and local R2. Observe application-requested shutdown
and independently confirm process/container exit before test teardown. Existing
mocked lifecycle calls, finite tool-script tests, and teardown removal do not prove
this. If native idle semantics cannot be exercised locally, record the precise gap
and retain the deployed-runtime proof gate pending explicit target authorization.

## Authority and completion

Local implementation, disposable verification, commits, branch publication, PR
delivery, and merge after required verification and independent review are covered
by standing delivery authority. Deployment and D1 conversion still require explicit
authorization covering their actual effect and target. No account,
profile, or physical database target has been established for remote ledger
inspection. Read-only resource discovery may establish the physical targets;
freeze the mapping before inspecting their ledgers. A real Alchemy plan
may bootstrap account state and is not a harmless inspection command.

Each fix needs relevant checks, actual runtime evidence for its acceptance claims,
and independent review of the immutable implementation head under the
[execution policy](../agents/execution-policy.md). Record evidence and remaining
gates here as work proceeds; mark completion only after the authorized merge.
The dependency upgrade and all three fixes (PRs #211, #210 and #212) are merged
after local verification, independent review and hosted CI. The authorized
repository queue is complete. The target-specific D1 release gate is independent
of repository completion; no
deployment, remote ledger inspection, or cloud mutation has been performed for this
queue.
