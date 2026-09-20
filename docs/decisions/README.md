# Decisions

Product decisions (PDRs) and architecture decisions (ADRs) share this register.
The prefix identifies the subject, not a different approval process. Keep the
original identifiers and dates. Use the [template](_template.md) for a new record.

Statuses are Proposed, Accepted, Superseded, Rejected, or Deprecated. Accepted
means a choice was agreed, not that it has been built. [Plans](../plans/README.md)
track implementation; [references](../README.md) describe existing contracts.
Read the decision relevant to a change, not the whole history.

## Register

- [ADR-0001 — Keep household people separate from accounts](adr-0001-separate-household-people-from-auth-members.md)
- [ADR-0002 — Account for every person's meal](adr-0002-model-plans-through-requirements-and-coverage.md)
- [ADR-0003 — Separate food, cooking, and prepared stock](adr-0003-separate-meal-content-preparation-and-stock.md)
- [ADR-0004 — Keep private chats separate from household data](adr-0004-household-agent-coordinator-and-isolated-chat-agents.md)
- [ADR-0005 — Keep the shared catalogue separate from private recipes](adr-0005-separate-shared-catalogue-from-household-recipe-authority.md)
- [ADR-0006 — Distinguish foods, exact products, and retailer listings](adr-0006-separate-food-concepts-products-and-retailer-listings.md)
- [ADR-0007 — Use a separate adapter for each recipe source](adr-0007-route-recipe-sources-through-specialized-adapters.md)
- [ADR-0008 — Check that a plan works before ranking it](adr-0008-separate-plan-feasibility-from-ranked-selection.md)
- [ADR-0009 — Sync shopping items with operations that are safe to retry](adr-0009-synchronize-shopping-lists-through-idempotent-item-operations.md)
- [ADR-0010 — Remove access before archiving a departing person](adr-0010-coordinate-membership-departure-before-person-archival.md)
- [ADR-0011 — Record completed conservative settlements consistently](adr-0011-canonicalize-completed-conservative-settlements.md)
- [PDR-0001 — Household people, profiles, and private interviews](pdr-0001-household-people-profiles-and-interviews.md)
- [PDR-0002 — Routines, fallback meals, and reasons for a plan](pdr-0002-routines-fallbacks-and-plan-rationale.md)
- [PDR-0003 — Build, change, approve, and review a complete week](pdr-0003-weekly-planning-repair-approval-and-review.md)
- [PDR-0004 — Food, portions, prepared meals, recipes, and shopping](pdr-0004-meal-content-portions-recipes-and-shopping.md)
- [PDR-0005 — First-release scope and deferred features](pdr-0005-mvp-scope-and-deferrals.md)
- [PDR-0006 — Evaluate the AI and collect release evidence](pdr-0006-ai-evaluation-and-release-evidence.md)
- [PDR-0007 — Decide who can see each conversation](pdr-0007-household-agent-conversations-and-visibility.md)
- [PDR-0008 — Handle visitors, temporary changes, and planning pauses](pdr-0008-temporary-context-visitors-and-planning-suspensions.md)
- [PDR-0009 — Collect, review, and publish shared recipes](pdr-0009-shared-catalogue-acquisition-curation-and-publication.md)
- [PDR-0010 — Generic foods, exact products, and retailer preferences](pdr-0010-food-concepts-exact-products-and-retailer-preferences.md)
- [PDR-0011 — Import a recipe by pasting its URL](pdr-0011-recipe-url-import-and-source-routing.md)
- [PDR-0012 — Choose a workable week using a repeatable policy](pdr-0012-planner-feasibility-ranking-and-deterministic-selection.md)
- [PDR-0013 — Present the plan clearly and test the experience](pdr-0013-plan-projection-rationale-and-experience-experimentation.md)
- [PDR-0014 — Share shopping lists and support limited offline use](pdr-0014-shared-shopping-list-collaboration-and-offline-use.md)
- [PDR-0015 — Run a small beta across several weeks](pdr-0015-invite-only-beta-cohort-and-learning-cadence.md)
- [PDR-0016 — Support beta households and repair failures](pdr-0016-beta-support-incidents-and-operator-repair.md)
