# Current Delivery State

- Last updated: 2026-09-12
- Delivery source of truth: this repository

## Latest Completed Stage

### Stage 1 — Household people, profiles, and permissions

- Stage record:
  [`stages/01-household-people/README.md`](stages/01-household-people/README.md)
- Status: Done (2026-09-05)
- Completed by:
  [`05-cumulative-exit-proof.md`](stages/01-household-people/05-cumulative-exit-proof.md)
  ([PR #205](https://github.com/cill-i-am/meal-planner/pull/205), merge
  `e77f2cf2a2e634fd43cab588980a73ee7ae9b6d2`)
- Active delivery: [Stage 2 planning](stages/02-private-discovery/README.md) was
  accepted on 2026-09-06.
  [Work Item 01](stages/02-private-discovery/01-private-session-foundation.md)
  is Done following explicit user authorization and completed local acceptance
  on 2026-09-06, delivered by
  [PR #215](https://github.com/cill-i-am/meal-planner/pull/215).
  [Work Item 02](stages/02-private-discovery/02-progressive-cards-and-confirmation.md)
  is Done through [PR #216](https://github.com/cill-i-am/meal-planner/pull/216),
  merged as `41b2a3e3f12c83edd3ddd9d184b9e138827101e6` on 2026-09-06.
  [Work Item 03 — adaptive discovery and evaluation](stages/02-private-discovery/03-adaptive-discovery-and-evaluation.md)
  is in progress in [draft PR #218](https://github.com/cill-i-am/meal-planner/pull/218).
  Private adaptive-turn implementation and local browser acceptance are complete.
  The [GPT-OSS v16 result](../../evals/private-discovery/prompt-v16-planning-purpose-results.md)
  persisted a false completed-update claim while canonical state stayed unchanged.
  The [Qwen v16 comparison](../../evals/private-discovery/prompt-v16-qwen-sampling-results.md)
  stopped at malformed JSON after one native success, preserving prior state.
  An [isolated Qwen tool diagnostic](../../evals/private-discovery/qwen-native-tool-serialization-diagnostic-results.md)
  observed a genuine native function call, but its arguments failed source
  continuity validation offline; it performed no native
  settlement and earned no discovery acceptance. Kimi's [first full request](../../evals/private-discovery/kimi-first-probe-results.md)
  and [clean full opening](../../evals/private-discovery/kimi-clean-opening-probe-results.md)
  both reached their deadlines without provider responses or usage receipts.
  The [tiny baseline](../../evals/private-discovery/kimi-structured-output-baseline-results.md)
  and [constant full-schema control](../../evals/private-discovery/kimi-full-schema-control-results.md)
  passed their bounded checks. The [JSON-object opening](../../evals/private-discovery/kimi-json-object-opening-results.md)
  returned valid structured output but failed semantic review by proposing an
  unsupported removal. The [v17 opening](../../evals/private-discovery/kimi-v17-json-object-opening-results.md)
  then passed its narrow semantic check: it retained the disclosed routine,
  asked one intent-clarification question and emitted no dependent proposal.
  Sustained interview behavior and card review/confirmation were not exercised.
  Kimi request support is now selectable alongside GPT-OSS and Qwen for the
  approved synthetic evaluation, with configuration still disabled by default.
  A [two-turn native checkpoint](../../evals/private-discovery/kimi-v17-native-dependency-checkpoint-results.md)
  ended after a local harness command error, with no family verdict. The
  [first full-suite baseline turn](../../evals/private-discovery/kimi-v17-native-baseline-failure-results.md)
  then failed `reply_decision`: Ask referenced a
  missing unresolved note. No assistant reply, card or continuity update persisted,
  and the canonical profile stayed unchanged. Prompt v18 requests proposals,
  reply, then continuity and explicitly requires the matching unresolved note;
  the shared output-schema declaration follows that order. Whether ordering helps
  generation remains an unverified hypothesis. The [v18 native suite](../../evals/private-discovery/kimi-v18-native-suite-stop-results.md)
  recorded six successful turns before rejecting seven continuity updates against
  the six-update limit. The baseline lacked its original-card review receipt;
  no family was accepted. Prompt v19 now explicitly omits unchanged notes and
  card operations and prohibits repeating the question in acknowledgement text.
  The [v19 run](../../evals/private-discovery/kimi-v19-native-suite-stop-results.md)
  recorded eight native successes and one
  `reply_decision` rejection for another missing unresolved note. Baseline
  coverage remained incomplete, and adult routines exposed a material draft
  selection defect. Its fixed judge scored household specificity 4/5 and profile
  synthesis 3/5; no family or human baseline was accepted.
  Kimi thinking at temperature 1.0 [failed its first native turn](../../evals/private-discovery/kimi-thinking-budget-limit-results.md)
  at the 4,096-token limit, without saving generated state. A
  [standalone opening with larger limits](../../evals/private-discovery/kimi-thinking-large-completion-results.md)
  passed JSON, output-schema and continuity checks using 5,537 completion tokens
  in 133.577 seconds. That diagnostic did not settle a native turn or establish
  family acceptance. The adapter now permits Kimi up to 65,536 completion tokens,
  a 900-second deadline and a 2 MiB whole response; that change retained GPT/Qwen
  limits, prompt v19, schemas and authority. The [native interview with larger limits](../../evals/private-discovery/kimi-thinking-large-native-dependants-results.md)
  completed four successful model turns and explicitly confirmed two supported
  adult facts. The native session completed, but the model did not elicit the
  required dependant avoidance, exact fallback or associated workload. Two
  generic questions preceded Review, with one of five candidate slots unused;
  the call ceiling did not force wrap-up. The challenge was unexercised and no
  judge or human rating ran. No family was accepted. The [v20 retest](../../evals/private-discovery/kimi-v20-native-dependants-results.md)
  completed three native turns and discovered the dependant avoidance, but ended
  before exact fallback/preparation discovery and the challenge. Five of eight
  candidate slots remained unused; zero families were accepted. V21 then introduced
  typed needs, but its [first attempt](../../evals/private-discovery/kimi-v21-first-attempt-provider-failure-results.md)
  ended with provider failure and an unknown upstream outcome. Its [second attempt](../../evals/private-discovery/kimi-v21-second-attempt-continuation-failure-results.md)
  returned structured output but atomically rejected a generic question reference
  without an unresolved note; no assistant text, card or typed need persisted.
  Prompt v22/policy v5 now make each unresolved note own its question and render
  reply wording from actual reviewed profile proposals and private typed state.
  Model-authored persistence/interface text and separate follow-up references are
  removed. Full message/state bounds and household authority remain unchanged.
  The [v22 native run](../../evals/private-discovery/kimi-v22-owned-replies-focused-results.md)
  completed four successful turns and handled exact fallback/preparation and the
  fixed challenge, but missed the adult's safety question. Coverage was three of
  four, with no native completion, judge or accepted family. Prompt v23 now retains
  that single generic topic when actual own-adult information or a settled note
  does not address it; policy, wire, rendering and limits remain unchanged.
  The [v23 focused test](../../evals/private-discovery/kimi-v23-safety-coverage-focused-results.md)
  passed all four required discoveries and the fixed challenge across four
  successful native model turns. Root and independent review passed all eleven
  hard assertions. The actual session completed at version 13 with eight retained
  messages and two explicitly confirmed own-adult facts at profile version 2.
  The fixed GPT-OSS judge scored both applicable dimensions 5/5 and flagged no
  possible hard failure. The [next v23 baseline](../../evals/private-discovery/kimi-v23-native-baseline-coverage-results.md)
  passed two native turns and same-card correction but missed ordinary-meal
  discovery, leaving coverage at two of three. All three cards remained
  unconfirmed; no completion, B or judge ran. V24 now adds one conditional
  usual-meals question through the existing notes, excluding explicit limited
  profile edits. Contract and native request-bound checks pass; fresh live
  coverage remains unverified. The product owner's qualitative acceptance of the
  earlier dependant example and [tone follow-up](private-discovery-conversation-tone.md)
  leave numerical ratings unset. No candidate or human baseline is accepted.
  The complete eight-family suite,
  completed candidate comparison, live A-to-B review, suite-wide fixed-judge
  evidence and all sixteen actual human ratings remain unmet. The draft is not
  ready to merge. The
  [owning work item](stages/02-private-discovery/03-adaptive-discovery-and-evaluation.md#current-evaluation-status)
  retains current scope and historical evidence.

Work Item 01 is complete. [PR #198](https://github.com/cill-i-am/meal-planner/pull/198)
merged its accepted person-registry implementation as
`9666a8bdae97bd9d6bf4efd98e30d03d617ccb31` on 2026-09-01 after its recorded
runtime, hosted-CI, and exact-head review gates. The merged stable person,
creator link, audit, receipt, API/UI, and isolation evidence is now the base for
Work Item 02.

The Work Item 01 identity boundary derives a stable household-scoped linkage
subject from immutable Better Auth user plus organization identity, separately
from its audit actor. Better Auth's actual `owner` membership role is the only
creator-bootstrap authority; other admitted members are denied before private
household routing. The roster carries canonical creator-slot availability
independently from both roster size and the requesting account link.
Deterministic domain failures are single-attempt. A pending or outcome-ambiguous
person mutation is the sole admitted roster command: the UI freezes sibling
actions and preserves the exact submitted payload and mutation ID until the
same command obtains a definitive result. The forms validate names before
submission and treat malformed generated-client responses as ambiguous rather
than deterministic domain failures. The public roster query rejects unknown
options. The cumulative runtime proof now covers the full Work Item 01 roster,
restart/restore history, owner/member bootstrap concurrency, and denied
cross-household mutation collisions.

[ADR-0010](../architecture/decisions/0010-coordinate-membership-departure-before-person-archival.md)
now fixes the missing cross-authority departure contract: `MealPlannerApi`
durably creates one deterministic native Cloudflare Workflow before the
authenticated Better Auth removal, the Workflow waits for an outcome signal
and reconciles a missing removal or lost signal by canonical membership read,
and only proven membership absence permits exact-purpose household
finalization. Every partial state remains durable, visible, bounded, and
repairable. Work Item 02 also configures
`organization({ disableOrganizationDeletion: true })` so neither the public nor
typed Better Auth deletion operation can erase the organization and its
memberships before the separate household deletion lifecycle exists. That
accepted prerequisite promoted Work Item 02 to implementation.
[PR #201](https://github.com/cill-i-am/meal-planner/pull/201) delivered the
Better Auth invitation-to-existing-person link, explicit repair and same-person
return, and the native access-first departure Workflow with both crash-window
reconciliation paths. Before contacting Better Auth,
the API durably binds the original person, payload digest, and mutation to a
deterministic provider invitation ID. After an ambiguous response or refresh,
the browser replays the exact retained invitation command with its original
person, intended email, payload, and mutation. If Better Auth was not reached,
that replay creates the missing original deterministic invitation; if Better
Auth committed but its response was lost, it reads and reuses that same
invitation. The separate association operation remains read-only with respect
to provider creation. No path lists opaque candidates, guesses among
same-household invitations, matches by email or name, or mints a replacement
person, invitation, or mutation. The browser also retains the original
departure request before submission and rediscovers its durable operation by
that exact preparation mutation after a lost response or refresh. Its status,
retry, and cancellation actions continue against the same operation through
pending, revocation-repair, finalization-repair, and terminal states. Full local
repository, real Better Auth D1 plus routed-object, twice/no-diff generation,
and container evidence passed for the corrected implementation. PR #201 merged
on 2026-09-04 as `9a59f85170f379e065920eadaaf69593d90c2c40`, following final
review of `34a376cb9a35fd6f177a0bf8b40e5c1dee938bd9` and green hosted
[run 33910287961](https://github.com/cill-i-am/meal-planner/actions/runs/33910287961).
Work Items 02 and 03 are `Done`.
[PR #202](https://github.com/cill-i-am/meal-planner/pull/202) merged on 2026-09-05
as `b509ba53ce1ac1326e86a9e826bdf58cbb0e7856` from final head
`44ffffc889a8b1893229906fe64c82fcf76c1bf3` after user approval and green hosted
[run 33951078370](https://github.com/cill-i-am/meal-planner/actions/runs/33951078370).
Focused proof covers profile persistence, immutable history and audit, exact
replay, safety confirmation, adult-edit races, archival/restoration, restart,
cross-household denial, dependant confirmation, and retained ambiguous UI
commands. Local repository tests, static checks, builds, and twice/no-diff
Household and D1 generation passed for the merged profile implementation.

The final UI correction additionally proves that delayed callbacks from an older
command cannot clear a newer unresolved command, and that authentication expiry
preserves the exact command through sign-in and explicit retry. Its affected web
suite passes 95 tests; root static checks and the web production build pass.
These corrections are included in the merged PR #202 head.

[PR #203](https://github.com/cill-i-am/meal-planner/pull/203) merged the seven-pass
cleanup on 2026-09-05 as `2fb37db0baa0c50f31afe658da9303c7a13bcd4c`.
It includes #202 unchanged at the profile feature and migration boundaries.
The combined branch passed all 1,068 repository tests and static/build checks;
the independent implementation review found no unresolved issues. Native
upgrade tests preserve completed provider settlements, including expired replay,
under the explicitly approved
[ADR-0011](../architecture/decisions/0011-canonicalize-completed-conservative-settlements.md).
[The cleanup delivery record](anti-slop-cleanup.md) owns its detailed evidence.

Work Item 04 now has a
[provider-free SDK boundary record](stages/01-household-people/04-agents-boundary-evidence.md).
Actual `agents@0.22.0` sub-agents run on the pinned local Miniflare/workerd
runtime, retain metadata across restart, and admit synthetic participant-only
access without a Household grant. The recommendation is to defer interview
implementation intact to Stage 2. That historical probe left production auth/link composition, the Alchemy bundle,
and passive/in-flight revocation as integration gates. The bounded
[private-output safety fix](private-output-safety.md) now implements and locally
exercises those boundaries and passed independent review. PR #211 merged as
`62adde277db478e91d2cf2c5d1efc54d90a2e76c`.
Stage 1's cumulative exit evidence is accepted through merged PR #205.
Organization deletion and conversation implementation remain out of scope.

[PR #204](https://github.com/cill-i-am/meal-planner/pull/204) merged the
accepted Work Item 04 boundary disposition on 2026-09-05 as
`5d629f0f3e1e9e7c2006d2b7a0c14fd235015013`, after independent review of
`2d607a77a509fec64047678add31fdab02053eea` and green hosted
[run 33974785385](https://github.com/cill-i-am/meal-planner/actions/runs/33974785385).
Work Item 04 is Done as boundary evidence, not conversation implementation. No
Stage 1 grant was implemented. The subsequent
[Stage 2 plan](stages/02-private-discovery/README.md) is now accepted, with its
private-session foundation separately authorized on 2026-09-06 and now locally
verified. Stage 1 completion itself did not authorize that work.

PR #205 merged on 2026-09-05 as `e77f2cf2a2e634fd43cab588980a73ee7ae9b6d2`
after independent review of `1b625121e835bc531fe7f5b6cd17bd04949c361e`
found no issues. All 1,068 local tests and both hosted checks in
[run 33975759741](https://github.com/cill-i-am/meal-planner/actions/runs/33975759741)
passed. The cumulative proof preserves profile, version, audit, and person
identity through invitation/linking and departure/return, including renewed
self-confirmation and departed-account denial. No production change was needed.

## Completed Foundation

- [PR #198 — person registry and lifecycle](https://github.com/cill-i-am/meal-planner/pull/198)
  merged on 2026-09-01 as
  `9666a8bdae97bd9d6bf4efd98e30d03d617ccb31`. Work Item 01 is `Done`.
- [PR #189 — household product blueprint](https://github.com/cill-i-am/meal-planner/pull/189)
  merged on 2026-08-27. Its product decisions, ADRs, and repository-owned
  delivery model are accepted direction.
- Stage 0 is complete. The household-authority foundation and cutover landed
  through [PR #182](https://github.com/cill-i-am/meal-planner/pull/182),
  [PR #183](https://github.com/cill-i-am/meal-planner/pull/183),
  [PR #186](https://github.com/cill-i-am/meal-planner/pull/186),
  [PR #187](https://github.com/cill-i-am/meal-planner/pull/187),
  [PR #188](https://github.com/cill-i-am/meal-planner/pull/188),
  [PR #190](https://github.com/cill-i-am/meal-planner/pull/190),
  [PR #191](https://github.com/cill-i-am/meal-planner/pull/191), and
  [PR #192](https://github.com/cill-i-am/meal-planner/pull/192).
- One `HouseholdObject` per Better Auth organization is the canonical writer for
  household product state. Better Auth D1 remains the identity, organization,
  membership, invitation, and role control plane. The remaining shared D1 owns
  only global provider accounting.

## Immediate Next Steps

The dependency upgrade merged in PR 209 as
`4b4e7fd651d66c2a03805eb00209c40fe3eb3240`. The
[prioritized risk fixes](prioritized-risk-fixes.md) record owns the
user's next-fix order: private output after authority changes, D1 release-ledger
safety, then media-container lifetime. Private output merged in PR #211 as
`62adde277db478e91d2cf2c5d1efc54d90a2e76c`. D1 release safety merged next in
PR #210 as `570dad6a4c021c153e2155ba32eef10b1bbba9d6` after independent review
and passing hosted CI. Media lifetime merged third in PR #212 as
`3114e448f8deb78833e90371ce266a63d779ab44` after independent review, native
Docker/DO/R2 lifetime proof and passing final hosted CI. The priority record owns
the exact heads and evidence. The authorized repository fix queue is complete.
This bounded queue does not promote the broader Stage 2, UI, model/provider,
or cost-tuning roadmap. No deployment or target-specific D1 reconciliation has
been performed.

The user subsequently accepted the bounded Stage 2 plan and the evaluation split
on 2026-09-06.
[Private session foundation](stages/02-private-discovery/01-private-session-foundation.md)
is complete: start, rediscover, resume, complete, and read retained private
history using the selected native child/fence.
[Progressive cards and confirmation](stages/02-private-discovery/02-progressive-cards-and-confirmation.md)
is also complete. [Work Item 03 — adaptive discovery and evaluation](stages/02-private-discovery/03-adaptive-discovery-and-evaluation.md)
is in progress in draft PR #218. Its native browser proof covers proposal,
same-card correction, explicit confirmation, Stop, process restart, and a fresh
session using the updated canonical profile. All 1,344 local tests pass across
the full baseline and affected reruns. Final UI acceptance also passed idle
opening, cross-adult privacy, and bounded two-tab recovery. The original
six-attempt live trial and seventh-call unknown readiness outcome retain their separate historical records. Later GPT
readiness passed after production commit `8626bebe` appended the generated
schema to the system instructions and advanced prompt provenance to v2. In the
new first-family attempt, three assistant outputs were accepted before a fourth
generation failed with `invalid_output`. An unsupported safety proposal failed
the material-fact assertion. Actual rejection and explicit confirmation of a
later correct safety card advanced canonical profile version 0 to 1, without
resolving that failure or the missing corrected preference and routine discovery.
Session A remained open at review; B and the other seven families had not run.
The [retry evidence](../../evals/private-discovery/gpt-schema-prompt-retry.json)
separates readiness from native quality and preserves these incomplete results.
V9 passed the adapter and exact proposal review without reproducing the original
failure. The subsequent prompt-v3 family failed the required same-card
correction and routine discovery. Its four A outputs were followed by actual
explicit confirmation, A completion, and fresh B state using canonical profile
version 1. B's first turn then failed with `invalid_output`, leaving that profile
unchanged. These observed transitions do not establish full privacy or repeat
acceptance. Prompt v4 failed same-card correction after two accepted native
outputs: the original proposal remained revision 0 while two new cards were
added. The trial stopped with A open at version 4 and the canonical profile
empty at version 0. Failure diagnostics pass 63 native and 27 adapter tests;
zero live events are expected because this failure passed output validation.
The earlier context-path review found no missing prior-card context, but retained
no direct provider wire receipt. A later audit identified and corrected the
native GPT-OSS response-format wrapper at `55a34ea`. In the resulting two-call
probe, the full-schema output still added new cards; the revision-only output
failed strict JSON parsing because of a trailing NUL. These new failures do not
establish the cause of historical failures or complete native family acceptance.
Both responses and cleanup were retained; no application state changed.
A six-call diagnostic ladder found that ordinary operation selection failed
twice while an explicit-revision ability control passed twice. Prompt v5 at
`3670c26e` then passed four full-production request controls: ordinary
correction twice, a mixed correction choosing the proper existing card and
preserving the other card, and new information producing one proposal without
revisions. A separate native proof then persisted the same-card correction using
one scripted seed and one live correction, while leaving the confirmed profile
unchanged. It does not establish a fully live interview or confirmation. Reply
wording lacked an explicit review cue and sometimes strengthened the stated
preference, without claiming a canonical save. Earlier failures and the
remaining family, comparison, and human-calibration gates are unchanged.
Those earlier phases had no soft-judge or human scores. The later
[v23 focused test](../../evals/private-discovery/kimi-v23-safety-coverage-focused-results.md)
passed its native discovery and hard checks, with fixed-judge scores of 5/5 for
both applicable dimensions. No actual human ratings, accepted configuration or
calibrated baseline follow from that result; the complete suite, candidate
comparison and live A-to-B gates remain open. No application deployment occurred.
Repeat review and dependant assistance follow in Work Item 04.
[PDR-0006](../decisions/product/0006-ai-evaluation-and-release-evidence.md#stage-specific-evidence-and-the-complete-beta-gate)
owns stage-specific discovery/profile evidence and the unchanged complete
connected pre-beta gate. Work Item 01 implementation and local automated
verification are complete: participant-only discovery, durable messages, exact
replay, completion, and retained private history are implemented. All 1,239
repository tests passed across full runs and affected reruns. Actual browser
creation/append/completion lost-reply recovery, passive sign-out, fresh-browser
rediscovery, and desktop/mobile verification also passed. Independent backend
and frontend reviews found no material issues.
[PR #215](https://github.com/cill-i-am/meal-planner/pull/215) delivers this work
item and owns the current hosted-check and merge record.
The work item's delivery record owns the exact runtime evidence and the native
idle-hibernation reconnect limitation. Provider execution remains outside this
slice, and no deployment is claimed.

[PR #216](https://github.com/cill-i-am/meal-planner/pull/216) delivered Work Item
02 as `41b2a3e3f12c83edd3ddd9d184b9e138827101e6` after independent backend and
UI approval of `925554e1ca1927f74a30e241ab1a029ecfd18b22` and passing Quality
and Synthetic media container checks in
[run 34042894812](https://github.com/cill-i-am/meal-planner/actions/runs/34042894812).
All 1,272 local tests passed across full runs and affected reruns, along with
static checks, builds, and twice/no-diff migration generation. Actual browser
acceptance proves private correction/rejection, explicit and safety confirmation,
stale review, exact lost-result recovery after restart, completed history,
cross-adult privacy, automatic shared-profile refresh, fresh login, and mobile
layout. Its delivery record owns the evidence and scoped accessibility result.
The local proof used Nitro UI, canonical API test composition, native production
classes, and synthetic proposals; it does not claim full operational bootstrap,
model/provider execution, cloud changes, or deployment.

The product owner has also accepted
[future site-wide json-render adoption](../product-blueprint/delivery-roadmap.md#accepted-future-interface-direction--json-render).
Its staged rollout follows the current discovery and evaluation work; it is not
an active implementation task.

## Deliberate Non-Work

Beyond the authorized private-output safety and Stage 2 Work Items 01–03, do not start
retailer integration, full pantry inventory,
calories/macros, medical goal systems, MCP delivery, embedded channels, or
generic organization support as part of this boundary investigation.
Do not implement organization deletion; keep it disabled until its accepted
household cleanup and tombstone lifecycle is separately authorized and ready.
