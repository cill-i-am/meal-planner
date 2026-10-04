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
7. For a later private review, start **Update my food profile**. The new
   session shows current shared facts and asks what changed. Review and confirm
   any proposed change; a completed earlier session remains history only.

The roster uses the people feature’s public Effect operations. Profile reads,
writes, and history use generated-client Effects and the shared Effect Query
adapter. The food-profile slice owns invalidation and profile recovery. A sole
decoded rejection releases a command; mixed Causes and defects preserve it.

## Evidence

The [Playwright page object](../../../../apps/web/e2e/pages/food-profile-page.ts)
drives visible controls. The [journey](../../../../apps/web/e2e/food-profile-journey.spec.ts)
crosses signup, family setup, the real local Website/API Workers, a profile save,
correction, and reload. The [Vitest browser tests](../../../../apps/web/src/features/household-profiles/household-profiles-panel.test.tsx)
exercise recovery and cache behavior in Chromium with a synthetic operations
adapter. The [generated-client browser tests](../../../../apps/web/src/features/household-profiles/browser-operations.browser.test.ts)
cover scoped reads, pagination, cancellation, and full Cause projection.
The [profile form tests](../../../../apps/web/src/features/household-profiles/profile-fact-form.test.tsx)
cover explicit safety confirmation.

Record the commit, runtime, action, result, and any unexercised paths for each
run. A component test does not prove the native storage path; a native request
does not prove the screen is usable. The auth/family map's [launch and evidence
rules](../auth-family/README.md#launch-and-establish-what-you-can-prove) apply
to this local Worker journey. Mail delivery and a live model are outside it.

The [private review page object](../../../../apps/web/e2e/pages/private-review-page.ts)
and [desktop/mobile journey](../../../../apps/web/e2e/private-review-journey.spec.ts)
covers fresh admission, two browser confirmations, profile versions and audit,
completed history and reload in local Workers using a synthetic model response.
The [browser component test](../../../../apps/web/src/features/private-interviews/private-interviews-panel.test.tsx)
covers the focused opening, and the [native A-to-B test](../../../../apps/api/src/features/households/household-boundary.integration.test.ts)
covers a synthetic model proposal, correction, two explicit confirmations,
profile versions/audit, and prior transcript exclusion. The browser journey
also rejects a B model context containing earlier dialogue or missing the saved
fact. The [confirmation transport tests](../../../../apps/web/src/features/private-interviews/private-confirmation.test.ts)
exercise the generated client, scoped headers, empty requests, response decoding
and cancellation. Native boundary tests reject copied, unadmitted, cross-origin,
malformed and body-substituted confirmations without exposing private bodies.
These tests do not exercise a live model or establish conversation quality.
