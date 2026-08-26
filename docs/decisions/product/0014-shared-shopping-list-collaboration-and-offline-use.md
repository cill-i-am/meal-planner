# PDR-0014 — Shared Shopping-List Collaboration And Offline Use

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Context

An approved plan creates one active household shopping list. Several adults may
shop, add household items, or update the list at the same time, and supermarket
connectivity is often unreliable. The product therefore needs useful shared and
offline behaviour without turning the MVP into a general collaborative document
system.

A whole-list last-write-wins model would be unsafe: one adult checking milk
should not erase another adult's newly added nappies, and an offline device must
not overwrite a newer derived list when it reconnects. At the same time, forcing
an online round trip for every checkbox would make the list unreliable in the
place where it matters most.

## Decision

### One shared active list

- All authorized household adults use the same active shopping list.
- Any adult may add a manual item, edit an admitted item field, check or uncheck
  an item, and perform the structural actions allowed by the current list state.
- Dependants have no shopping-list access in the MVP.
- Mutations record the acting adult and authoritative time and remain available
  through ordinary household audit or item history where useful.
- Plan-derived demand, manually added household items, purchased state, and
  items retained after a plan revision remain distinguishable.

### Connected collaboration

- Connected clients receive accepted item and list changes without needing to
  refresh the whole page.
- Synchronization applies item-level operations or authoritative list changes;
  a client never replaces the complete shared list merely because it holds a
  local copy.
- Two adults setting the same item to the same checked state is harmless.
- The server's accepted operation order is authoritative when adults submit
  different check states for the same item.
- The product may expose who made the latest change without making routine
  shopping interactions feel like an audit console.

### Narrow offline capability

The active list is cached locally for authenticated use when connectivity is
lost.

While offline, an adult may:

- view the most recently synchronized active list;
- set an item's desired checked or unchecked state; and
- add a simple manual item.

Those changes are shown as pending and queued for synchronization. The client
does not claim that another adult has received them or that the server accepted
them until synchronization succeeds.

The MVP does not support offline structural recalculation. The following require
an online connection:

- applying or accepting a plan revision;
- regenerating plan-derived shopping demand;
- merging or splitting items;
- changing a derived quantity or its source assumptions;
- resolving an ingredient-identity or unit-conversion conflict; and
- other operations whose correctness depends on current authoritative list or
  plan state.

### Conflict behaviour

- Offline check state is synchronized as a desired final value, not as a blind
  toggle.
- Queued manual additions use a stable client-generated identity or idempotency
  key so retry cannot create duplicates.
- Structural commands use optimistic concurrency against the authoritative list
  or item version.
- A stale structural edit fails with current state and an understandable
  conflict; the product never silently applies last-write-wins.
- If an offline operation refers to an item that was removed, replaced, or
  materially changed while the client was disconnected, the operation remains
  visibly unresolved or fails explicitly. It is not silently remapped to a
  different item.
- Accepted plan-revision behaviour continues to preserve manual items and
  purchased or checked state according to PDR-0004.

### Sharing boundary

- The MVP shopping list is available only to authenticated authorized household
  adults.
- Public links, anonymous collaboration, and unauthenticated shared checklists
  are out of scope.
- Lightweight conveniences such as copy, print, or device-native sharing may be
  added where they do not create an editable external authority or leak private
  household state.

## Consequences

- The household authority needs stable shopping-list and item identities,
  item-level mutation commands, idempotency, authoritative ordering, and
  optimistic concurrency for structural edits.
- Clients need a rebuildable local cache, a small durable pending-operation
  queue, synchronization status, and explicit failure handling.
- Check and uncheck commands should express desired state rather than toggle
  intent so replay is safe.
- Real-time transport improves collaboration but does not become shopping-list
  authority.
- The MVP delivers a dependable supermarket experience without implementing a
  general CRDT or full offline-first plan editor.

## Deferred

- public or anonymous shopping-list links;
- dependant shopping-list accounts;
- offline plan revisions or shopping-demand regeneration;
- offline merge, split, quantity, and identity-resolution operations;
- arbitrary multi-device collaborative document semantics;
- household-configurable conflict policies; and
- retailer basket synchronization or checkout.
