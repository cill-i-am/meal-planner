# An agent-led family meal journey

Status: done
Owner: current implementation team
Depends on: family resources, people and profiles, private discovery, recipe imports
Delivery: one feature branch, `codex/ai-native-family-journey`; no merge or deployment

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

The follow-up local preview uses an AI-only Alchemy OAuth profile. Local account
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
and recipe import workflows remain unconfigured locally. See the
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
