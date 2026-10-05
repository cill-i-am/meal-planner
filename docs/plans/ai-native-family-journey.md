# An agent-led family meal journey

Status: active
Owner: current implementation team
Depends on: family resources, people and profiles, private discovery, recipe imports
Delivery: one PR from `codex/ai-native-family-journey` into main after review and required checks

## Outcome and context

Families can describe their household, review the people and preferences the
assistant proposes, and build a saved plan covering everyone's meals and snacks
for one or more weeks. They can review substitutions, personal alternatives,
leftovers and meals away, then open a recipe and follow its cooking steps.

The implementation starts from fetched `origin/main` at `34ba00d`. The approved
[connected entry designs](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-J-0)
and [family planning designs](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-I-0)
are the visual source. Additional states belong in the editable
[implementation states page](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-K-0).

## Scope

- Connected signup, login, recovery, family creation and editable roster review.
- Account-private setup conversation and family-shared assistant, with a bounded
  catalog of questions and reviewable proposals.
- Separate private adult discovery, confirmed household facts, and explicit
  attribution when an adult helps a managed person.
- Reviewed meal content, routines, fallback choices, suitability and quantities.
- Person-level coverage over one to twelve weeks, saved draft and approved plans,
  explicit revisions, prepared portions and cooking instructions.
- Responsive desktop and mobile workspace using shadcn composition and json-render.
- Impeccable and Better UI review, with purposeful motion, quiet interaction
  sounds, a visible mute control and reduced-motion behavior.

The follow-up explicitly authorizes Workers AI for the local preview. Deployment,
external email, billing changes, retailer checkout, medical advice and inferred
food-safety expiry remain outside this assignment. Fixture checks and live
provider evaluation are separate evidence.

## Approach and trade-offs

Each domain owns its schemas, transitions and application operations. Browser
operations use shared Effect HttpApi contracts and generated clients. Host
adapters compose authentication, canonical context, persistence and providers.
AI produces proposals; admitted application commands own confirmed writes.
Private transcripts never become shared household history.

The planning model replaces the earlier slot-only draft. Coverage identifies
person, date and occasion. Plans pin content and profile versions, preserve
explicit unknowns, and require complete, valid coverage before approval. Stock
reservation and approval share one household transaction. An approved plan stays
stable until the user accepts a proposed revision.

Frontend features expose small public components and controllers. Conversation,
questions, review forms, meal cards and cooking views compose shared primitives;
they do not become modes of one large journey component. Remote state has one
query owner. Unknown mutation results retain the original request identity.

GPT-6 Sol lanes own auth, family setup, conversation runtime, discovery UI, meal
content and routines, planning rules, and planning UI. The coordinating agent owns
host composition, workspace routes, theme, package integration and final checks.

## Acceptance

- [x] Signup, login and recovery preserve validation, pending and error behavior.
- [x] A family can be created through reviewed agent output or a manual path.
- [x] Roster acceptance is recoverable and does not duplicate people after retries.
- [x] Conversation scope, actor admission and proposal versions are enforced.
- [x] Private adult history remains private; only confirmed facts are shared.
- [x] Food and routine edits persist through reload with optimistic conflict handling.
- [x] Plans cover every managed person/date/occasion, including explicit gaps.
- [x] Approval rejects incomplete, unsuitable or overallocated coverage.
- [x] Swaps, fallbacks, meals away and leftovers use canonical reviewed content.
- [x] Approved plan revisions require explicit acceptance and stock reconciliation.
- [x] Recipes show reviewed ingredients and methods; unknown amounts remain unknown.
- [x] Desktop and mobile flows match Paper and remain keyboard accessible.
- [x] Motion preserves interaction continuity; sound respects the saved preference.
- [x] Focused tests, native persistence checks, integration checks and review pass.
- [x] Updated feature maps and this plan distinguish local checks from live evaluation.

## Delivery and open questions

The feature is implemented on `codex/ai-native-family-journey`. GPT-6 Sol agents
implemented and reviewed the feature slices. The approved design is retained in
Paper, with 37 additional implementation-state artboards covering recovery,
proposal review, preparation, portions, cooking, and routine management.

### Local verification

- Workspace typecheck, lint, formatting, build and documentation checks pass.
- API regression: 1,203 tests across 98 files pass with two workers. The earlier
  resource-contention timeouts at default parallelism did not recur.
- Web regression: 257 tests across 42 files pass.
- Native browser journeys: eight tests pass across desktop Chromium and mobile
  WebKit. They exercise committed-response recovery, adult admission, questions,
  confirmed food facts, a two-week all-occasion plan, shared cooking, planned
  leftovers, approval, one-person takeaway changes, saved recipes and cooking.
- Shared contract suites pass. The root infrastructure suite's 182 other tests
  passed; the tracked-source architecture case passes after staging all new
  modules and declaring the two exact new composition/migration owners.
- Impeccable and Better UI reviews informed the final spacing, continuity,
  reduced-motion and sound treatment. Populated plan, day, recipe, cooking and
  food-question views report no automated WCAG A/AA violations. Native browser
  and manual visual checks cover 320, 390 and 1440 px. Automated contrast checks
  leave gradient surfaces for manual inspection; this is not a full accessibility
  certification. Sound preference and playback gating were checked, but audible
  output was not measured.
- Independent domain and frontend reviews were completed, and their actionable
  findings were fixed. The final domain pass found no remaining P1/P2 issues.

### Evaluation boundary

The browser fixture supplies deterministic model responses at the provider seam;
it uses the real Agent persistence, HTTP boundaries and canonical domain writes.
These tests establish application behavior, not the quality of a live model.
Provider configuration is explicit, and unavailable models return an actionable
state. Hosted CI, merge and deployment are not claimed. No external email or
production deployment was activated.

The earlier limited preview used an AI-only Alchemy OAuth profile. Local account
and household data persist across restarts. Initial GPT-OSS family turns exposed
invalid tool output. A scoped setup schema and exact examples produced a valid
live question; roster quality remained under investigation. The user then chose
GPT-6 Luna through Cloudflare billing. After the user funded AI Gateway, live
Responses checks passed for a missing-details question and an editable roster
with the creator separated from additional family members. No canonical family
was created by those synthetic checks. The new transport also passes a streamed
provider fixture, including validation and disabled provider logging/storage.
The persistent preview then passed a real browser turn: the user's family
description produced a focused question naming the supplied family members.
Reload and restart retained the signed-in account and conversation.
Private setup now receives the authenticated account name; a live check asked
only for the missing family name. A missing local household mutation binding
was then corrected. The user's retained creation action recovered successfully
to the four-person family review. A separate provider-free native smoke verified
creator linking, person creation and exact mutation replay without duplication.
Shared planning model quality remains unverified. Private interview inference
and recipe import workflows were unconfigured in that limited preview. Native
Alchemy development now owns the local runtime; see the
[local guide](../how-to/local-development.md).


## Conversational family creation refinement

The October follow-up replaces the chat-to-form handoff with plain conversation
and a persistent family table. The authenticated name fills the first place.
People arrive from typed proposals, corrections update the table, and explicit
agreement saves the exact displayed family and opens food discovery automatically.
Manual entry is a deliberate switch; unsent chat and manual edits survive switching
modes. Remote state and uncertain writes remain owned by the existing controller,
Agent and canonical family services.

Five implementation and review passes were completed:

1. **Interaction:** replaced generated text cards and click approval with plain
   questions, typed conversational agreement and a stable reviewed action.
2. **Table and motion:** retained the table throughout setup; added place arrivals,
   short exits and name transitions, with reduced motion and a quiet send sound.
3. **Conversation:** shortened replies, removed UI jargon and duplicate questions,
   used account context and aligned the composer with desktop dialogue.
4. **Recovery and access:** retained exact unknown actions across reload; fixed the
   unavailable-chat manual path, disabled composer styling and manual draft loss.
   Added live table announcements, a scroll tooltip and a concise save cue.
5. **Independent critique:** separate GPT-6 Sol reviewers evaluated design and ran
   the narrow Impeccable detector. Visual findings were corrected on desktop and
   mobile. The final design assessment scored 30/40; all three detector scans were
   clean. Overlay injection was not verified because the alternate browser
   preflight stalled; no overlay is claimed.

The [conversation-first Paper page](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-L-0)
contains twelve desktop/mobile states: initial place, displayed draft, correction,
agreement and saving, uncertain-save retry and deliberate manual entry. Existing
approved designs remain in their original pages. Paper uses fictional sample names.
[Jakub Krehel's Better UI skills](https://github.com/jakubkrehel/skills) informed
motion, layout, accessibility and copy; no dependencies were upgraded.

Verification includes 19 focused API tests and 7 shared-contract tests, 14 browser
component tests, and the native family journey on Chromium and mobile WebKit.
The separate planning journey passed Chromium after restarting its disposable
fixture; its earlier 429 came from reusing synthetic client IPs across runs.
Type checks, narrow lint, formatting, documentation links and migration checks
passed. Final native results are recorded with the completed branch commit.

A separate live Alchemy run used GPT-6 Luna through the existing Cloudflare-billed
Gateway. A disposable account described four people, changed Leo to Theo and the
family name, explicitly agreed, reached food discovery without another click and
retained all corrected people after reload. This proves that exercised live path;
it does not replace the deterministic recovery tests or claim deployed changes.

## Merge latest main into the feature branch

Status: done

The conversational setup refinement was committed as `88c3512`. The next
explicit goal fetches and merges `origin/main` at `253e982` into this feature
branch. It does not merge into main or deploy. The histories diverged by 15
feature commits and 17 main commits, with 42 conflicted files.

### Combined behavior

- Keep the conversational family table, exact confirmation, retry receipts,
  manual alternative and complete meal workspace.
- Adopt main's structured recipe content and planning tags at the published
  recipe boundary. Keep the richer person-and-occasion plan lifecycle and
  remove the superseded slot planner.
- Adopt stable Effect 4, Alchemy beta.80, native command and migration ownership,
  typed browser operations, observability and main's required CI gate.
- Refresh the existing Alchemy patch against the exact package. Keep its native
  agent export beside generated Effect Durable Object and SQL migration bridges.
- Native dev reads explicit optional local model settings and does not create
  remote gateways or tokens. Deployment keeps its stage-owned resources.
- Reject unexpected people queries and externally supplied stock reservations
  with explicit Effect 4 boundary parsing. Reject setup acceptance without the
  exact saved conversational confirmation.

### Verification

The first merge was recorded as `4dc1e1f`. Main advanced during verification,
so the same branch now also incorporates `4f01179`, including exact import-command
recovery and the updated engineering guidance. Two additional conflicts in the
recipe workspace and its tests were resolved without restoring the old shell.

Current checks pass: workspace typecheck and production build, shared package
suites (92 tests), frontend suites (291), root infrastructure and asset checks
(111), native Worker suites (122), API regression (1,094), and all 36 desktop and
mobile browser journeys. Formatting, lint, documentation checks, documentation
checker tests and a frozen-lockfile install pass. Independent source reviews
found and verified the setup-confirmation fix. Mobile verification found and
fixed a disclosure tap lost before hydration.

Full native Alchemy verification passes (3 tests in 22.4 seconds with the image
cached). It checks actual API and Website routing, native migrations, signup,
family creation, request replay, reads and same-origin telemetry. The initial
FFmpeg source build took 17 minutes on this Mac and exceeded the first test's
startup limit. Warming the image exposed an unsupported planning-context read
in the provider. Using Alchemy's documented `ALCHEMY_DEV` configuration fixes
that runtime boundary; the healthy API and complete native suite verify it.

No cloud resources were deployed or new inference credentials created. On
2026-10-05, the user authorized reading the archived Alchemy credential source.
The existing dev gateway and scoped token were restored to the ignored local
environment file, with owner-only permissions. Native Alchemy development uses
GPT-6 Luna through Cloudflare Responses for both conversation configurations.

A separate synthetic account verified live family setup in the browser: the
agent used the account name, added three people to the table, corrected a child's
name and the family name, and saved the family after conversational confirmation.
It advanced automatically to Our tastes. Reload retained all four people and the
corrected names. The live food conversation then returned its first question.
This verifies those exercised paths; it is not a broad model-quality evaluation.
The current main tip was checked again as `4f01179` before the final merge commit.

The pstack principles Prove It Works and Fix Root Causes guided actual Worker
bundle and user-path checks, explicit confirmation validation, request-scoped
runtime access and the hydration correction. PR monitoring and shipping remain
outside the user's earlier feature-branch endpoint.

## Review and main delivery, 2026-10-05

The user authorized review rounds, a PR and merge into main. The branch now
includes main at `cafd1dd`. Round one reviewed standards, the approved product
scope, backend invariants, runtime configuration and comments independently.

The fixes under review cover retained Food Book and plan requests after an
unknown response, roster cache ownership and identifiable fact review, cook
output validation, repaired prepared-food pins, and preservation of retired
slot-plan records. Focused tests reproduced the failures before the fixes and
passed afterward. The second backend review found a further refresh deadlock
after a cook option disappeared; its regression now verifies repair, editing
and approval. Fresh final frontend and backend reviews passed at `d6cee5e`
without remaining P0-P2 findings.

On the first review head, all 36 desktop and mobile browser journeys passed.
API tests (1,094), web tests (291), native Worker tests (122), shared-package
tests and all three native Alchemy stack checks passed. Typecheck, production
build, lint, formatting and documentation checks passed. The native export
bundle test exceeded its five-second default during concurrent builds and
passed in isolation; this check will run again after the fixes.

Native Alchemy now replaces the earlier limited preview launcher. The duplicate
local runtime and standalone smoke were removed; the native stack suite owns
that verification. The new roster-failure state is represented on desktop and
mobile in the [Paper implementation states page](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-K-0).

Integrated-head checks pass for production build, typecheck, formatting, lint,
documentation, all 297 frontend tests, all 36 desktop and mobile journeys and
three native Alchemy stack checks. The final API run hit three five-second
timeouts and a subsequent closed runtime socket during concurrent heavy checks;
the isolated two-worker run is pending. The earlier review head passed all
1,094 API tests. No test assertions or runtime deadlines were relaxed for this
API rerun. The generated archive snapshot was formatted automatically without
changing its parsed structure.
