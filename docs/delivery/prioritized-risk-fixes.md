# Prioritized fixes after the dependency upgrade

- Recorded: 2026-09-06, from the user's explicit priority instruction.
- Status: Queued after dependency-upgrade publication; analysis only. No fixes
  implemented.
- Delivery owner: the current dependency-upgrade task; one implementation owner
  will carry each fix when its lane starts. Technical scope advisers are read-only.
- Continuation base: `376517b8aa78a9410fe880e1e495b903394e49c0` on
  `codex/latest-dependencies-2026-09-05`. The upgrade is locally complete; its
  independent exact-head PASS covers parent
  `8f2a3e4953a3d2de5c537c4572205c45cd8107bf`. The successor only aligns documented
  Node/pnpm prerequisites and changes no source or dependencies. Neither head is
  published or merged. Its
  [verification record](../infrastructure/dependency-upgrade-2026-09-05.md)
  owns the detailed evidence. This record is on a separate continuation branch.

Implement and verify these fixes in the following order. Safe scoping may proceed
now; none is complete merely because the upgrade checks passed. This order
supersedes the older efficiency-review recommendation. Broader Stage 2, chat UI,
models/providers, container sizing, outbox tuning, and other cost work remain
outside this queue.

## 1. Prevent private output after authority changes

**Queued first.** The
[Agents boundary evidence](stages/01-household-people/04-agents-boundary-evidence.md)
proves synthetic admission and denial on the next custom message. Production
Better Auth → API → HouseholdObject → Agent composition remains unproven; no
production Agent currently exists. This is an integration gate, not evidence of
a currently exposed private-output leak. SDK protocol handling may precede
`onMessage`, so connection admission and custom-message checks are insufficient.

Build a provider-free composition proof using real Better Auth D1, current active
linked-adult authority in HouseholdObject, an isolated Agent, and synthetic private
output. Use the supported Alchemy Worker/native Durable Object export and existing
bundle-fixture seam. Preserve immutable household/account-linkage/person binding
and retained completed metadata; do not persist session credentials in Agent
metadata or logs. No Household grant, transcript, model, or chat UI is needed.

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

**Queued second.** Alchemy beta 76 can convert `d1_migrations` during an approved
D1 reconciliation; an unchanged resource may remain a deployment no-op. Deployed
histories are uninspected. The exact-version transport patch remains required;
[the Alchemy review](../infrastructure/alchemy-upgrade-review.md) owns its removal
criteria and [the infrastructure guide](../infrastructure/alchemy.md) owns target
selection and bootstrap gates.

For both `MealPlannerAuthDatabase` and `ProviderAccountingDatabase`, identify the
release SHA, stage, Alchemy profile, independently resolved account, and physical
database name/UUID before account inspection. Map the deployed ledger shape and
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

**Queued third.** Artifact cleanup does not establish container shutdown. The
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

Local analysis, implementation, and disposable verification stay within the
bounded fix scope. Publication/PR creation, merge, deployment, and D1 conversion
require explicit authorization for their actual effect and target. No account,
profile, or physical database target has been established for remote ledger
inspection; resolve that scope before contacting the account. A real Alchemy plan
may bootstrap account state and is not a harmless inspection command.

Each fix needs relevant checks, actual runtime evidence for its acceptance claims,
and independent review of the immutable implementation head under the
[execution policy](../agents/execution-policy.md). Record evidence and remaining
gates here as work proceeds; mark completion only after the authorized merge.
No push, PR, merge, deployment, remote ledger inspection, or cloud mutation has
been performed for this priority record.
