# ADR-0009 — Synchronize Shopping Lists Through Idempotent Item Operations

- Status: Accepted
- Date: 2026-08-26
- Related product decision: [PDR-0014](../../decisions/product/0014-shared-shopping-list-collaboration-and-offline-use.md)

## Context

The active shopping list is shared household product state. Several authorized
adults may change it concurrently, while clients also need limited offline use in
shops with unreliable connectivity.

Replacing the whole list from a client snapshot would lose concurrent edits.
Blind `toggle` operations are also unsafe under retries: replaying one operation
twice can return an item to the wrong state. A general CRDT would add significant
complexity before the product needs arbitrary collaborative document editing.

## Decision

### Canonical authority and local projection

- The canonical active shopping list and item state remain owned by the
  household product authority, directionally `HouseholdObject`.
- A browser or device cache is a rebuildable local projection for display and
  narrow offline use; it is never authoritative.
- Real-time delivery, polling, or another synchronization transport may carry
  accepted changes, but transport state does not own shopping truth.

### Stable identities and operation contracts

- Shopping lists and shopping items use stable semantic identities.
- Offline-capable item state changes express a desired value, for example
  `SetShoppingItemChecked { itemId, checked: true }`, rather than `ToggleItem`.
- Manual offline additions carry a client-generated stable identity or
  idempotency key.
- Every admitted mutation is authorized, decoded through a closed schema, and
  idempotent at the household command boundary.
- The household authority assigns authoritative ordering, time, resulting
  versions, and receipts.

Directionally:

```ts
type OfflineShoppingOperation =
  | {
      readonly kind: "set_checked"
      readonly itemId: ShoppingItemId
      readonly checked: boolean
      readonly operationId: ShoppingOperationId
    }
  | {
      readonly kind: "add_manual_item"
      readonly proposedItemId: ShoppingItemId
      readonly label: string
      readonly operationId: ShoppingOperationId
    }
```

The implementing capability may refine fields and naming. The invariant is that
replay produces the same accepted outcome rather than applying an operation a
second time.

### Structural commands

Operations that can alter derived demand or relationships require current
server state and an expected version, including:

- plan-revision application;
- demand regeneration;
- item merge or split;
- derived quantity changes;
- source-line, food-concept, or unit-resolution changes; and
- mutations that redistribute provenance or purchased state.

These commands are online-only in the MVP and use optimistic concurrency. A
version mismatch returns current state and a classified conflict rather than
silently overwriting newer work.

### Offline queue and replay

- The client stores only the small admitted offline-operation union, not an
  arbitrary patch or serialized replacement list.
- Pending operations remain visibly pending until acknowledged by the household
  authority.
- Replay preserves client operation identity and original intent while allowing
  the server to assign current authoritative order and time.
- Reconnect does not assume every queued operation remains applicable.
- An operation targeting a removed, replaced, or materially changed item returns
  an explicit stale-target or conflict result. It is never heuristically applied
  to another item merely because the labels look similar.
- Successful acknowledgements update the local projection and remove the exact
  queued operation.

### Check-state conflicts

- Setting the same desired state repeatedly is naturally idempotent.
- When accepted operations request different states, the household authority's
  accepted ordering determines current state.
- Attribution and operation history remain available for support or user-facing
  explanation where useful.
- The system does not attempt a semantic merge of contradictory checked states;
  checking and unchecking are ordinary reversible actions.

### Plan revisions and item continuity

- Plan revision continues to use the shopping delta and preservation policy
  accepted in PDR-0004.
- Item identity or lineage should remain stable where one logical requirement
  continues across a revision.
- Where a revision genuinely removes or replaces an item, stale offline
  operations fail or require review rather than being silently transferred.
- Manual items and purchased or checked state are preserved according to the
  owning product decision, not by accidental client-side merge behaviour.

## Consequences

- Offline behaviour remains bounded, testable, and replay-safe.
- The server needs an operation receipt or deduplication mechanism and stable
  list and item versions.
- Clients need a pending-operation store and reconciliation state, but do not
  need a general-purpose local replica protocol.
- Concurrent whole-list replacement and blind toggle commands are forbidden.
- A future broader offline capability can add admitted operation variants or a
  superseding synchronization design without changing current shopping-list
  authority.

## Alternatives Rejected

### Replace the full list from the client

Rejected because an offline or stale snapshot can erase another adult's changes,
plan-derived updates, provenance, or purchased state.

### Use toggle commands

Rejected because retries and duplicate delivery can invert state more than once.
Desired-state commands are idempotent and easier to explain.

### Use silent last-write-wins for every edit

Rejected because structural list mutations can lose meaningful concurrent work
or corrupt plan-derived demand.

### Introduce a general CRDT in the MVP

Rejected because the accepted offline surface is small and operation-based.
Arbitrary collaborative document semantics would add complexity without current
product value.

### Let the local cache become authoritative while offline

Rejected because it cannot validate current plan, item lineage, identity,
quantity, or concurrent household state.
