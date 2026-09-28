# Food profile browser feature

Read the [food profile intent map](../../../../../docs/reference/food-profile-intent-layer.md) and [user journey](../../../../../docs/reference/features/food-profiles/README.md) before changing this feature. The [household profile reference](../../../../../docs/reference/household-people-api.md#household-visible-profiles) owns the domain and recovery guarantees.

Keep roster and profile reads, mutation identity, uncertain-result recovery, and query invalidation in this feature's hooks. Screens own the person selector, fact forms, visible messages, and navigation. Other features import `index.ts` rather than internal modules. A private transcript never enters the shared profile cache.

The existing generated `HouseholdPeopleApiClient` covers profile HTTP calls. Preserve the submitted command and mutation ID after an unknown result; a stale version requires a fresh read and explicit resubmission. Keep safety changes on their separate confirmation path.
