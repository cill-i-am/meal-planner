# Household food profile feature map

This is the first saved household feature after [family setup](../auth-family/README.md).
It covers manual review and correction of household-visible food facts. Private
conversation quality, AI proposals, and assisted dependant interviews belong to
[private discovery](../../private-discovery.md) and its plan.

## User journey

1. Create an account and complete family setup. Enter the application at `/`.
2. Open **Food profiles** and choose a person. A linked adult can confirm their
   own facts; information entered for another adult remains provisional.
3. Add a food preference. Reload and verify the same fact and profile version.
4. Correct that preference. Reload and verify the replacement, incremented
   version, and history. The fact keeps its identity.
5. For a safety fact, inspect the old and proposed meanings and explicitly
   confirm a change or removal. Missing facts never imply safety clearance.
6. If a submitted result is unknown, retry the exact saved command. A stale
   version requires a fresh read and explicit resubmission.

## Evidence

The [Playwright page object](../../../../apps/web/e2e/pages/food-profile-page.ts)
drives visible controls. The [journey](../../../../apps/web/e2e/food-profile-journey.spec.ts)
crosses signup, family setup, the real local Website/API Workers, a profile save,
correction, and reload. The [Vitest browser tests](../../../../apps/web/src/features/household-profiles/household-profiles-panel.test.tsx)
exercise recovery and cache behavior in Chromium with a synthetic operations
adapter. The [profile form tests](../../../../apps/web/src/features/household-profiles/profile-fact-form.test.tsx)
cover explicit safety confirmation.

Record the commit, runtime, action, result, and any unexercised paths for each
run. A component test does not prove the native storage path; a native request
does not prove the screen is usable. The auth/family map's [launch and evidence
rules](../auth-family/README.md#launch-and-establish-what-you-can-prove) apply
to this local Worker journey. Mail delivery and a live model are outside it.
