# Ten additional gardening passes

Requested on 7 October 2026 after PR #289. Earlier passes do not count. The starting main was `6581682`, including the documentation reset in PR #291. This record covers exactly ten distinct passes and preserves the retained skills and domain protections. Execution used pstack poteto-mode, Babysit and Shipping; local codebase-design and improve-codebase-architecture guided selection, with retro used for recurring friction.

**Completed: 10 of 10.** Seven passes produced reviewed changes across eight implementation/tooling PRs; three ended in evidence-backed no-ops. All selected changes are merged and their production deployments are verified. Application journeys ran against native Worker fixtures; production evidence consists of Alchemy deployment results and the anonymous HTTP checks below.

| Pass | Area | PR | Delivery status |
| --- | --- | --- | --- |
| 1 | Complexity and verification tooling | [#292](https://github.com/cill-i-am/meal-planner/pull/292), [#294](https://github.com/cill-i-am/meal-planner/pull/294) | Completed; production verified |
| 2 | Private interview input and lifecycle | [#293](https://github.com/cill-i-am/meal-planner/pull/293) | Completed; production verified |
| 3 | Conversation schedule materialization | [#295](https://github.com/cill-i-am/meal-planner/pull/295) | Completed; production verified |
| 4 | Food Book and planning browser data paths | [#296](https://github.com/cill-i-am/meal-planner/pull/296) | Completed; production verified |
| 5 | Recipe acquisition and import review | [#297](https://github.com/cill-i-am/meal-planner/pull/297) | Completed; production verified |
| 6 | Household membership and people lifecycle | No-op | Completed; decision recorded on merged main |
| 7 | Provider accounting and recovery | [#298](https://github.com/cill-i-am/meal-planner/pull/298) | Completed; production verified |
| 8 | Tesco catalogue and retailer adapters | No-op | Completed; decision recorded on merged main |
| 9 | Authentication, invitations and recovery | No-op | Completed; decision recorded on merged main |
| 10 | Frontend readiness and shared controls | [#299](https://github.com/cill-i-am/meal-planner/pull/299) | Completed; production verified |

## Pass 1 evidence

Traced complexity enforcement, schedule and fixture-routing helpers, documentation checks and evaluation provenance. Retained domain admission, capacity, reservation, routing and validator guarantees. PR #292 restored native cccc 1.7.0 setup guidance in the retained testing skill without changing limits.

The native complexity check passed 727 files and 11,232 functions, with maximum cognitive complexity 40 and cyclomatic complexity 38. Documentation verification passed 211 Markdown files and 19 checker tests; eight schedule tests, eight evaluation tests and skill validation passed. Independent review passed.

Repeated apt provisioning stalls occurred before application browser tests. PR #294 replaced browser provisioning with the version-matched Playwright 1.63.0 container. Required checks and preview passed in [CI run 37681272233](https://github.com/cill-i-am/meal-planner/actions/runs/37681272233). PR #292 merged as `24251370`; PR #294 merged as `86bf0153`. [Production run 37682618821](https://github.com/cill-i-am/meal-planner/actions/runs/37682618821) and [preview cleanup 37682619359](https://github.com/cill-i-am/meal-planner/actions/runs/37682619359) succeeded.

## Pass 2 evidence

Traced the private interview page, account-bound panel, generation-bound chat, client admission/recovery, profile loading and proposal correction. Removed duplicated queued/running checks from `private-profile-cards.tsx` because `isAssistantTurnActive` already owns them. Retained generation ownership, stale-callback rejection, unresolved-request recovery and explicit safety confirmation.

All 36 private interview component tests passed before and after the deletion. Independent review compared 112 old/new expression combinations with identical results. Web typecheck, lint, formatting and whitespace checks passed. The native private-review journey passed in Chromium. An initial WebKit disclosure failure preceded the changed panel; three baseline and three changed-code repeats passed. Pass 10 investigated that readiness failure separately. The earlier isolated empty-input timeout did not have a repeatable cause; no speculative remount or input-reset change was made.

PR #293 merged as `f46db36234940297b9f077a0d227e050b565e948` after [CI run 37682918596](https://github.com/cill-i-am/meal-planner/actions/runs/37682918596) passed. [Preview cleanup 37683809259](https://github.com/cill-i-am/meal-planner/actions/runs/37683809259) succeeded. [Production run 37683807759](https://github.com/cill-i-am/meal-planner/actions/runs/37683807759) succeeded.

## Pass 3 evidence

Cook events now own generated prepared-output sources through one row/date map. Deleted `outputSources`, constant batch/output conflict checks and redundant updates; constant event fields are readonly. Unique row keys and one resolution per row establish the ownership invariant. Admission, overlap, quantity, unit, yield, reservation and same-week checks remain; planning capacity validation retains its owner.

Three public-interface regressions cover separate same-date outputs, duplicate keys with disjoint requirements and source rows without output. All 47 focused tests passed across four files before and after the refactor. API typecheck, lint, formatting, native complexity and whitespace checks passed. Independent review passed with 18 focused tests; all four native planning journeys passed in Chromium and WebKit in 46.4 seconds. PR #295 merged as `d46bc6fd` after [CI run 37683958378](https://github.com/cill-i-am/meal-planner/actions/runs/37683958378) passed. [Production run 37685557279](https://github.com/cill-i-am/meal-planner/actions/runs/37685557279) and [preview cleanup 37685558211](https://github.com/cill-i-am/meal-planner/actions/runs/37685558211) succeeded.

## Pass 4 evidence

Traced Food Book and planning query/recovery callers. Removed the one-caller `usePlanningContentSnapshot` forwarding hook; FamilyConversation uses the public query options through `useQuery` directly. Moved the real routine-label behavior to `routine-choice-label.ts` with its body unchanged. Query policy, displayed identity and recovery retain their owners.

Five focused Chromium component files passed nine tests covering the caller, Food Book/meal-plan requests, recovery and identity isolation. Independent review passed, including four Our tastes/Food Book tests. Web typecheck, lint, formatting, whitespace and complexity checks passed. Native journeys passed 3/4: both planning journeys and Chromium recipe review. Mobile WebKit failed at sound readiness before cooking assertions. A baseline experiment reproduced that separate bug; pass 10 fixes it. PR #296 merged as `6722a93f` after [CI run 37685580827](https://github.com/cill-i-am/meal-planner/actions/runs/37685580827) passed. [Production run 37686578688](https://github.com/cill-i-am/meal-planner/actions/runs/37686578688) and [preview cleanup 37686579211](https://github.com/cill-i-am/meal-planner/actions/runs/37686579211) succeeded.

## Pass 5 evidence

Traced recipe acquisition, resolver, extraction claims, stored drafts and evidence recovery. Removed the unreachable 1,029-line carousel pipeline, `claimCarousel` and unused JPEG dependency/configuration after finding no entrypoint callers or adapter/repository implementation. The live resolver rejects carousel sources. Retained persisted carousel codecs, stored transcript shapes, evidence authority and the live video path's recovery.

The source change spans 11 files with 24 additions and 1,097 deletions. Author verification passed 90 import tests, including native Workflow replay/recovery, three evidence-bucket tests, API typecheck, full lint and changed-file formatting. Independent verification passed 49 focused and 13 native runtime tests. These checks do not verify live TikTok/provider state. PR #297 merged as `d00f3600` after [CI run 37687520465](https://github.com/cill-i-am/meal-planner/actions/runs/37687520465) passed. [Production run 37688885097](https://github.com/cill-i-am/meal-planner/actions/runs/37688885097) and [preview cleanup 37688886195](https://github.com/cill-i-am/meal-planner/actions/runs/37688886195) succeeded.

## Pass 6 evidence

Completed no-op. Inlining two lifecycle error-class files violated `max-classes-per-file`; the attempt was reverted cleanly without weakening the rule. Retained membership, profile and recovery ownership. API typecheck, four native lifecycle tests and 13 workerd tests passed; independent Astra review passed. Reviewed base `24251370` has application code identical to the starting `6581682` baseline. The decision is recorded on merged main through PR #293.

## Pass 7 evidence

Traced operator settlement identity, response outcomes and D1 recovery. One `settlementPlan` now maps both identity and outcome for speech, visual, recipe and recipe-recovery operations. Deleted the duplicate four-operation switch. Reservations, invocation fences, settlement persistence, operator authorization, stage/run identity, recovery and migrations remain unchanged.

Four real-D1 characterization cases passed before the refactor. Afterward, all 33 accounting worker tests and seven upgrade/boundary tests passed, including wrong stage/run rejection, recovery-run isolation, charging once on replay and retaining unknown actual cost. API typecheck, lint, formatting, configured cccc and whitespace checks passed. Independent review reran 33 worker and five upgrade tests successfully. PR #298 merged as `96898a60` after [CI run 37688906452](https://github.com/cill-i-am/meal-planner/actions/runs/37688906452) passed. [Production run 37690625569](https://github.com/cill-i-am/meal-planner/actions/runs/37690625569) and [preview cleanup 37690626233](https://github.com/cill-i-am/meal-planner/actions/runs/37690626233) succeeded.

## Pass 8 evidence

Completed no-op. Traced Tesco catalogue and retailer requests at source base `6581682`. Retained read-only GraphQL restrictions, bounded replay after a 401 response, and token/cookie isolation. These modules own request and authentication guarantees that deletion would redistribute to callers. Independent Astra review passed. The decision is recorded on merged main through PR #293.

## Pass 9 evidence

Completed no-op. Traced authentication, invitation admission and account recovery at source base `6581682`. Retained recipient privacy, consent, atomic mutation, fencing and preservation of unresolved requests. Independent Astra review passed. The decision is recorded on merged main through PR #293.

Shared independent verification for passes 8 and 9 passed 167 tests across 23 files: 95 Tesco/atomic-authentication tests in 13 files, 30 browser-authentication tests in five files, 40 real-workerd tests in four files and two invitation-application tests in one file. This verifies the covered behavior and runtime contracts, not a live Tesco account or vendor state.

## Pass 10 evidence

Controlled mobile WebKit pointer experiments found two readiness bugs. Roster arrival moved a disclosure 508 pixels between press and release while preserving its DOM identity. Family arrival replaced the pending header's sound button before release; no click, preference-change event or stored update occurred. Control clicks after readiness worked.

Extended the disclosure `inert` guard through initial roster loading. Explicit `StatusScreen.pending` flows to the sound button's native `disabled` property in six pending branches. Stable, error and retry screens retain interactive controls. Private access, proposal confirmation, preference storage and event semantics remain unchanged.

Both held-response regressions failed before their fixes and passed afterward. The combined fix passed both readiness regressions and the canonical recipe/sound journey in Chromium and WebKit, 6/6. The disclosure fix also passed four disclosure/private-review checks and two focused checks. Three component checks cover pending disabled behavior, default error-screen interaction and retry. Independent review passed four native and three component checks. Web typecheck, lint, formatting and whitespace passed. PR #299 merged as `1dda946a` after [CI run 37686601768](https://github.com/cill-i-am/meal-planner/actions/runs/37686601768) passed. [Production run 37687477824](https://github.com/cill-i-am/meal-planner/actions/runs/37687477824) and [preview cleanup 37687477514](https://github.com/cill-i-am/meal-planner/actions/runs/37687477514) succeeded.

## Completion evidence

Final application commit `96898a60721fae069485b845e4a033f68bb84d97` contains all eight implementation/tooling merges. The eleven agent-authored commits in those PRs are unsigned and use conventional messages; GitHub generated its own signed squash commits. Each changed pass has an independent review and required CI at the delivered head. Passes 6, 8 and 9 have independent no-op reviews and the verification described above.

Read-only production checks at 21:46 UTC on 7 October 2026 observed:

| Request | Response |
| --- | --- |
| [Home](https://ceird.app/) | HTTP 200, HTML |
| [Anonymous session](https://ceird.app/api/auth/get-session) | HTTP 200, JSON `null` |
| [Anonymous family list](https://ceird.app/v1/families) | HTTP 401, `FamilyUnauthorized` |

These checks confirm basic public reachability and rejection of anonymous family access. No production account was created, no authenticated workflow was exercised, and no vendor operation was invoked.

## Retrospective

The deletion test protected valuable policy. Membership, stock allocation, privacy, evidence authority and recovery stayed with their owners; verified forwarding layers, duplicate state and unreachable code were removed.

Controlled browser experiments turned two intermittent failures into real readiness bugs with repeatable regressions. The small guard deletion in pass 2 did not claim to fix them.

Version-matched native browser containers removed unreliable apt provisioning without weakening application checks, timeouts or complexity limits.

Strict main checks require each PR to update after the preceding merge. Keep scouting, independent review and local verification parallel; ship current-trunk PRs sequentially. Cancel obsolete-head checks before deployment rather than spending capacity on results that cannot satisfy the merge rule.
