# PDR-0014 — Share shopping lists and support limited offline use

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Decision and reason

Authorized household adults share one active shopping list. Item-level changes
prevent checking milk from erasing another person's addition. Dependants and
anonymous/public collaborators have no MVP access.

Adults may add manual items, edit admitted fields, check/uncheck and perform
allowed structural actions. Record actor and authoritative time. Distinguish
plan-derived demand, manual additions, purchased state and retained items.
Connected clients receive accepted changes without full-page refresh and never
replace the whole list with a local copy. Identical check-state writes are
harmless; server acceptance order resolves competing check states.

## Limited offline use and conflicts

Cache the active list for authenticated offline viewing. Offline adults may set
desired checked/unchecked state and add a simple manual item. Mark queued changes
pending until accepted; do not claim other adults have received them.

Plan revisions, demand regeneration, merge/split, derived quantity changes,
identity/unit conflict resolution and other structural recalculation require an
online connection. Synchronize desired values, not blind toggles. Stable
client-generated identities/idempotency keys prevent duplicate additions.
Structural edits check current list/item versions and reject stale edits with an
understandable conflict. Removed/replaced/materially changed offline targets stay
unresolved or fail explicitly; never silently remap operations to another item.
Transport, local cache and pending queues remain subordinate to server authority.

## Revision and manual-item lifecycle

An accepted revision recalculates plan demand. Unneeded unchecked/unpurchased
plan items leave the outstanding list while retaining history and lineage.
Checked/purchased items remain visible for that list's lifetime as bought but no
longer required, without counting as outstanding demand. Revisions never remove
manual household items.

When creating a new active list, carry forward unchecked manual items with their
food/non-food and manual provenance. Checked manual items finish with the archived
list. No separate recurring-staples subsystem is required.

Copy, print or device sharing may be added only without leaking private state or
creating another editable authority. Public links, dependant accounts, offline
structural operations, general collaborative-document semantics, configurable
conflict policy, recurring-staples automation and retailer basket/checkout remain
deferred.
