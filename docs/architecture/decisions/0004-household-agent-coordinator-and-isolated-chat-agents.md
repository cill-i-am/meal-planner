# ADR-0004 — Household Agent Coordinator And Isolated Chat Agents

- Status: Accepted
- Date: 2026-08-25
- Related product decision: [PDR-0007](../../decisions/product/0007-household-agent-conversations-and-visibility.md)

## Context

Meal Planner needs durable, resumable conversation state for private interviews,
private adult chats, and shared household planning. The runtime should support
long-lived identity, message persistence, reconnection, streaming, tool
orchestration, and future ad hoc agent use.

The repository already has one canonical SQLite-backed `HouseholdObject` per
Better Auth organization. That object owns household product truth and local
cross-capability transactions. Storing model loops, WebSocket connections,
streaming state, or raw private transcripts in the same object would mix a
long-lived conversational runtime with canonical product authority and create a
hotter, broader privacy boundary.

Cloudflare's Agents SDK provides an agent runtime built on Durable Objects. A
household-scoped parent agent and isolated child or thread agents satisfy the
existing child-object criteria: they have independent connection and session
lifecycles, different privacy and retention concerns, durable runtime identity,
and no need for atomic transactions with household product state.

## Decision

### One household agent coordinator

- Each Better Auth organization receives one privacy-safe, versioned
  `HouseholdAgent` identity.
- The household agent is implemented with the Cloudflare Agents SDK on Durable
  Objects, subject to an exact-version implementation spike before code lands.
- It coordinates shared household conversation, thread and session discovery,
  streaming connections, resumable work, model and tool orchestration,
  conversation summaries, and agent-runtime lifecycle.
- The household-agent locator derives its identity only after Better Auth
  membership authorization and follows the same privacy-safe routing principles
  as `HouseholdObject`.

### Isolated conversation agents

- Private adult chats and private interviews use isolated agent instances or
  Agents SDK sub-agents with separate durable identity and storage.
- Shared household planning chat uses a household-visible agent or thread whose
  state may be synchronized only to authorized adult members.
- Private and shared message stores are never rows in one undifferentiated
  synchronized chat instance.
- The parent coordinator may manage child lifecycle and route authorized work,
  but it does not expose a general operation that returns another adult's raw
  transcript.
- If the pinned Agents SDK cannot provide the required sub-agent isolation
  cleanly, an equivalent child Durable Object boundary is preferred over
  weakening privacy or storing all messages in the parent.

### Authority split

`HouseholdAgent` and its isolated conversation agents may own:

- conversation messages and transcript lifecycle;
- thread visibility and participant metadata;
- streaming and reconnection state;
- unfinished conversational work;
- model, prompt, tool, and policy provenance;
- conversation-local summaries and retrieval metadata; and
- agent-runtime schedules or wake-ups that do not become product truth.

They do not own:

- household people or membership authority;
- confirmed profiles, routines, or fallbacks;
- recipes or recipe versions;
- meal plans, coverage, cook events, or allocations;
- prepared stock, feedback, approvals, or shopping lists; or
- mutation receipts for household product commands.

Those facts remain canonical in `HouseholdObject`. The agent runtime reads them
through admitted queries and changes them only through typed, authorized,
idempotent commands.

### Interaction with household transactions

- Model calls, external provider calls, WebSocket operations, and agent storage
  access never occur inside a `HouseholdObject` transaction.
- An agent completes external reasoning first, constructs a closed proposed
  command, and sends it through the private household command boundary.
- The household authority assigns authoritative time, identity, versions,
  ordinals, results, and receipts.
- A failed or interrupted model turn cannot imply that a household mutation
  committed; command replay semantics remain owned by `HouseholdObject`.

### Model adapter

- The agent runtime consumes one thin application-owned model service or adapter
  sufficient to support primary-model calls, eval fakes or recordings, usage and
  provenance capture, and provider replacement.
- The seam must not reproduce a general AI SDK for its own sake or leak provider
  request and response types into household domain code.
- AI SDK, TanStack AI, a direct provider client, or another library may implement
  the adapter after an eval-backed spike. The library does not own product
  semantics or confirmed state.

### Context and memory

- Durable history is not automatically concatenated into each prompt.
- Shared turns use current confirmed household state plus relevant shared thread
  context and bounded summaries.
- Private turns may additionally retrieve relevant history belonging to that
  adult or private thread.
- Private transcript content cannot enter shared context unless the participant
  explicitly promotes a structured fact or grants the separate support access
  accepted in PDR-0001.
- Any cached or derived memory that affects planning is noncanonical and must be
  rebuildable from authorized source state or explicitly confirmed before it
  becomes product truth.

### Lifecycle and deletion

- Household deletion must include an explicit, idempotent cleanup path for the
  household agent and all child conversation agents.
- Membership removal immediately prevents the departed adult from resolving or
  connecting to shared or private household agent instances.
- Completed interview agents may remain retained and read-only according to
  PDR-0001, but authorization is still checked at access time.
- Agent state must not be able to lazily recreate a household after the global
  household deletion tombstone has been committed.

## Consequences

- The system introduces another Durable Object namespace and independent
  per-object schema and lifecycle in addition to `HouseholdObject`.
- Principal propagation, private/shared thread authorization, deletion, and
  observability require explicit proof across the agent-to-household boundary.
- The household product object remains protected from connection churn,
  unbounded transcript growth, and model-runtime concerns.
- Conversation isolation is physical as well as logical where private child
  agents are used.
- The parent agent can provide one coherent household assistant experience while
  private sessions remain separate.
- The exact Agents SDK API and package version remain implementation details to
  verify against the pinned Cloudflare and Alchemy stack.

## Alternatives Rejected

### Put every conversation in one household chat agent

Rejected because message synchronization and broad parent access would create a
serious risk of exposing one adult's private interview or chat to another adult.
It also makes retention and support access harder to reason about.

### Use only one agent per adult

Rejected because the household needs a shared planning conversation, one
coordinator for thread discovery and orchestration, and a coherent place to
manage household-level chat lifecycle.

### Store transcripts and chat runtime inside `HouseholdObject`

Rejected because canonical product transactions should not share lifecycle,
capacity, privacy, and connection concerns with streaming model conversations.
It would also encourage model or transport I/O near product transactions.

### Let the agent own confirmed household state

Rejected because agent memory and model outputs are not deterministic product
authority. Profiles, routines, plans, and approvals need the existing strict
household command, receipt, version, and transaction model.

### Build a large provider abstraction before selecting a library

Rejected because it would add abstraction for its own sake. The accepted seam is
only the thin application boundary needed for tests, eval provenance, and
provider replacement.

## Private-output implementation decision — 2026-09-06

The `agents@0.22.0` composition probe selects the already permitted equivalent
native child Durable Object boundary. SDK sub-agents enqueue output through an
asynchronous parent RPC bridge; a child-side authorization check is therefore
not adjacent to the physical socket send. A separate native runtime probe also
confirmed that a top-level Agent's inherited `sql` and `state` RPC expose its
storage. Private sessions consequently use a plain `PrivateInterviewSession`
Durable Object with ECMAScript-private database fields and a physical native
WebSocket. No SDK private method override or bridge patch is used.

`HouseholdAgent` remains an SDK Agent. A second SDK `AccountOutputLifecycle`
coordinator is keyed by immutable account identity because session revocation
can affect multiple households without a complete, race-free membership
snapshot. Both coordinators retain only child-generation registrations and
mutation lifecycle metadata. They do not cache membership, grant access, own
Household product receipts, or store raw private content. The account coordinator
is an invalidation index, not an additional authority or Household table.

An output generation starts disabled, registers durably with both coordinators,
and then obtains fresh Better Auth session/membership and Household linked-adult
reads. Only that still-current generation may activate. Each canonical authority
writer first blocks registration and obtains durable invalidation acknowledgments
from every registered child. It then acquires a single durable dispatch claim
before changing canonical state. The child checks generation and captured session
expiry synchronously immediately before each physical `send`, with no intervening
await. Restart invalidates retained generations. A completed session keeps its
original immutable household, account-linkage, and person binding.

Only the native WebSocket output path is enabled. Private HTTP response bodies,
raw-content-returning internal RPC, SDK state synchronization, callable/tool/MCP
protocols, and parent transcript access are absent. The parent's runtime child
capability exposes invalidation only. Conversation production and transcript
storage remain separate future work.

Lost invalidation acknowledgments retry the retained pre-dispatch operation.
Known durable completion can be reread after a lost completion acknowledgment.
An auth write whose canonical outcome is unknown after dispatch leaves the account
fenced across restart; no timer, lease, or later authority snapshot may reopen it.
Distinct canonical mutation intents retain independent fences and may proceed;
settling a newer operation does not settle the unknown operation or admit output.
This is a deliberate residual availability limit, not a complete automatic recovery
claim. Household commands can recover a known outcome using their existing exact
mutation receipts. See the [implementation evidence](../../delivery/private-output-safety.md)
for the native proof and disabled-path checks.
