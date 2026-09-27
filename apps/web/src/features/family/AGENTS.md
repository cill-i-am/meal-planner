# Browser family feature

Own family selection, generated-client operations, query keys, people commands, and roster management. Other slices use [index.ts](index.ts), not private files. The [family reference](../../../../../docs/reference/family-api.md) owns state, version, and recovery guarantees.

Family context exposes the selected resource. Query definitions and mutation hooks own transport, retry identity, and cache updates; screens own local fields and navigation. Setup route loaders preload those same queries.

Use Effect Query options with TanStack Query for remote state; React owns form and dialog state. Scope cache keys to account and family, and invalidate the owning queries after writes. Family selection refreshes the shared account query, including its active organization.

A saved person and an invitation are separate outcomes. Keep a successfully saved person when its invitation fails. Keep unknown submitted commands in memory while mounted through [request recovery](../request-recovery/AGENTS.md), using the original payload, version, and key. Never invent success after an unknown response.

[Onboarding](../onboarding/AGENTS.md) owns screen composition; it does not own these operations. See [people behaviors](../../../../../docs/reference/features/auth-family/people.md) and colocated save tests plus native people integration tests.

Keep roster responsibilities separate: [roster-model.ts](roster-model.ts) holds pure decisions and command construction; [roster-commands.ts](roster-commands.ts) dispatches typed operations; [use-roster-management.ts](use-roster-management.ts) owns mutation lifetime and cache updates. Actions, overlays, and feedback own presentation. Pass request IDs into pure command construction. A family change remounts its context subtree so dialogs and saved results cannot cross families.

A confirmed server save remains successful even when a later refresh fails. Keep its returned result and let the screen retry continuation without another create command. Effect Query failures and ordinary callback errors have different shapes; decode or narrow them before using adapter-specific methods.

An expired-session person save keeps its exact command and offers login in another tab. Retry in the original mounted screen after authenticating as the same user. Account changes still dispose private local state. Restore focus to the matching roster action after an overlay closes, including the renamed person's menu button.
