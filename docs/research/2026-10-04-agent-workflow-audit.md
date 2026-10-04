# Agent workflow audit

Status: complete source audit; adoption changes proposed
Date: 2026-10-04
Scope: Meal Planner code, documentation, agent rules, skills, tooling and relevant chat history

The [agreed workflow](../plans/agent-workflow-adoption.md) is achievable. The root
instructions already authorize implementation through merge. The main obstacles
are conflicting supporting guidance, stale plans, incomplete mechanical
enforcement, and a delivery workflow that has not yet been installed and connected.

Adopt one execution owner, remove repeated approvals inside agreed scope, and
retain the domain and verification guarantees that make independent work safe.
This report proposes changes; it does not install skills, change product policy,
configure GitHub protection, or claim runtime defects were reproduced.

## Coverage

The source snapshot is `e0fbc94dfd96438dc5ac82fc9082900a5db6ffef` in the `d4ec`
worktree. Other Meal Planner chats and main have newer work. Findings describe
this checkout unless explicitly identified as live GitHub or historical evidence.

- Reviewed every file under `docs`, every repository `AGENTS.md`, all six local
  skill entrypoints and their text resources, the Codex hook configuration, and
  the application documentation outside `docs`, including Impeccable records.
  The reconciled Markdown inventory contains 311 files, with no repository
  Markdown file absent from the review manifests. Vendor scripts were inspected
  for workflow clauses and routing rather than audited line by line.
- Reviewed relevant shared coding/design skills and installed Cloudflare skill
  guidance. Unrelated document, shopping, pets and personal-administration plugins
  were outside the application-workflow audit. Dynamic skill output was not run.
- Inventoried all 12 API features, seven packages, and web features; inspected
  contracts, ownership, cross-feature imports, recovery paths and representative
  tests. This was not a line-by-line correctness review of every implementation or
  test body. The API/package inventory alone contains 427 TypeScript files.
- Read the scripts and CI workflow, test/runtime configuration and evaluation
  harness. Inspected current GitHub branch rules and a completed main CI run.
- Used Matt's `retro` and `writing-for-agents` methods. Reviewed selected primary
  turns from eight related chats plus this conversation. Historical assistant
  claims are evidence of workflow, not proof of current PR or deployment state.

The accompanying [coverage record](2026-10-04-agent-workflow-audit-coverage.json)
separates full reads, sampled source, inventory-only files and external guidance.
It records the scope and limitations rather than implying every source line was
reviewed. No application test suite, live Paper session or browser journey was run
by this audit.

## Findings

### 1. Make the approved workflow executable and enforce its finish line

**High priority; setup gap.** The agreement exists, but neither selected bundle is
installed or activated. Root [AGENTS.md](../../AGENTS.md) already says implementation
includes merge after checks and reviews. Another permission policy would duplicate
that authority. Configure one execution route that carries the approved plan
through implementation, independent review, real-surface verification, CI and merge.

The evaluated pstack port's Babysit playbook stops at merge-ready and starts only
when requested. Its Shipping playbook performs independent verification and
landing. The repository route must chain both automatically for an approved
implementation request. Conflict handling must return to the owning agent, not
back to Cillian for a routine rebase. Review-only and planning-only requests retain
their narrower endpoints.

There is also a missing structural safeguard: the live GitHub rules endpoint for
`main` returned `[]`; the classic protection endpoint returned 404. CI's deployment
dependencies protect deployment order, but do not themselves prevent an unchecked
merge. Configure required checks for the current CI job names. Preserve independent
agent review without requiring Cillian to click a human approval on every PR.
The agent must still verify the current patch and check state before merging.
In particular, the workflow also runs when a PR closes, with validation jobs
skipped. A successful closed-PR run is not evidence that the patch passed tests.
Inspect the actual required jobs and revision, not just the newest green run.

The [observed main run](https://github.com/cill-i-am/meal-planner/actions/runs/37231080147)
passed, including production deployment, at head `253e9820f2c9f75e8e83e12400435bbd20de17da`.
That is live delivery evidence, not a claim that this older checkout is main.

### 2. Replace the one accepted policy that requires routine human release review

**High priority; explicit policy conflict.**
[PDR-0006](../decisions/pdr-0006-ai-evaluation-and-release-evidence.md), lines
240–271, requires human review of two green scenarios for every ordinary model,
prompt, tool or orchestration candidate. Judge/rubric changes require a full human
rescore. Fully autonomous AI-behavior delivery cannot satisfy that rule as written.

Replace the ordinary green-candidate gate with calibrated automated evaluation
and independent agent review. Keep initial human calibration, periodic product
calibration, escalation for material regressions or judge drift, and external-beta
acceptance. Hard privacy, safety and correctness failures must remain blocking.
An agent score must never be recorded as a human score. The sixteen outstanding
baseline ratings in the [adaptive-discovery plan](../plans/private-discovery/03-adaptive-discovery-and-evaluation.md)
remain outstanding until actually supplied or explicitly superseded by a new
decision. This is the policy decision needed for adoption, not a request for a
new approval at every release.

### 3. Remove hidden pauses from skill references and design rules

**High priority; conditional instruction conflicts.** The local skill entrypoints
have already been simplified. Some supporting files still carry the old process.
These rules activate when those resources are selected; they do not run on every turn.

| Source | Friction | Proposed change |
| --- | --- | --- |
| [Web AGENTS](../../apps/web/AGENTS.md), line 13 | Unagreed new screens or substantial redesigns still require Paper agreement, even when product/architecture direction is approved. Reapproval of an already agreed design is explicitly prohibited. | Delegate outstanding screen design and verification to the agent within the agreed direction. Return for material product changes. Preserve the approved visual source and unavailable-tool fallback. |
| [Alchemy gotchas](../../.agents/skills/alchemy/references/gotchas.md), line 7 | Blanket explicit-confirmation wording can override the entrypoint's reuse of existing authorization. | Use the same target/effect-aware authorization language as the skill entrypoint; retain protection for unrelated destructive operations. |
| [Infrastructure operations](../how-to/operate-infrastructure.md), lines 398–399 | Live provider tests require separate action-time approval. | Qualify this with “when the provider, environment, spend and cleanup are not already authorized.” |
| [Impeccable critique](../../.agents/skills/impeccable/reference/critique.md), lines 41–48 and 245–266 | Host-specific delegation assumptions, fixed review procedure and follow-up priority questions. | Use the host's actual tools and existing delegation authority. Let the owning agent prioritize in-scope findings instead of returning routine decisions to the user. |
| [Impeccable document](../../.agents/skills/impeccable/reference/document.md), lines 71 and 116–128 | Refresh/merge confirmation and multiple interviews can restart already settled direction. | Reuse agreed requirements; ask only for missing decisions that materially affect the result. |
| Impeccable command metadata, finish-reviewer and design-ledger references | Older fixed phases, scoring, capture and interview requirements survive behind the short entrypoint. | Reconcile the references as well as the router. Preserve useful visual, accessibility and runtime proof; remove compulsory ceremony unrelated to the change. |

Keep the distinction between product consent and engineering permission. An agent
may implement a confirmation flow autonomously; it may not fabricate household
consent or weaken private-output access rules to finish faster.

### 4. Reconcile the active plans before agents use them as a work queue

**High priority; demonstrated drift.** A future agent can follow the wrong plan
faithfully and undo the architecture that later decisions approved.

- [Onboarding](../plans/onboarding.md), line 141, requires inviting every adult;
  its later lines 379–385 and current code allow adults without accounts or
  invitations. Active gap rows 156–160 also describe missing declined state,
  reset callbacks and persisted drafts that no longer match the implementation.
- [Browser-runtime consolidation](../plans/library-consolidation/01-browser-runtime.md)
  records completed October 4 migrations but still gives an AtomHttpApi pilot and
  people migration as next work. Close the delivered Query consolidation and give
  any remaining experiment a separate, useful objective, or cancel it.
- [The plans index](../plans/README.md) and library parent retain older active-work
  and stack instructions. Reconcile with current source and live PR status; keep
  genuinely unmet acceptance items open.
- [Onboarding transitions](../../apps/web/.impeccable/onboarding-transitions.md),
  lines 24–39, still prescribe durable checkpoints. Current feature instructions
  and the family-resource decision keep unsubmitted drafts and unknown commands
  in mounted memory. Mark obsolete behavioral sections superseded; retain their
  visual and accessibility decisions.
- [Dependant assistance](../plans/private-discovery/04-repeat-review-and-dependant-assistance.md),
  lines 54–57, serializes provider-free implementation behind live quality
  evaluation. Run independent implementation and deterministic verification while
  the final quality and external-beta acceptance remain open.

Delete superseded instructions instead of creating another archive hierarchy.
Keep concise historical results and links where they explain current decisions.
The existing documentation standard already specifies this maintenance behavior.

### 5. Repair command and verification guidance at its entrypoints

**High priority; demonstrated routing errors.** Root [README](../../README.md),
the [API README](../../apps/api/README.md) and the
[auth/family map](../reference/features/auth-family/README.md) still say `pnpm dev`
starts the Tesco Node host. Root `package.json` now starts native Alchemy; the
focused Node command is `pnpm dev:tesco`. Link the canonical local-development
guide instead of maintaining three command descriptions.

The API README's focused test command omits sixteen native Worker test files.
Those run in `@meal-planner/worker-tests` and in CI. The root recursive test command
includes them, so this is misleading local guidance, not absent CI coverage.
Conversely, the development guide and browser CI label describe auth/family-only
coverage even though the suite now includes food-profile and synthetic-model
private-review journeys. State exactly which command proves which surface.

The standards still name `@cloudflare/vitest-pool-workers`; the installed native
workspace uses `@cloudflare/vitest-plugin` with Vitest 4.1.11; ordinary tests use
Vitest 5.0.3. That split satisfies the plugin's peer constraint and should stay.
Native tests use a July compatibility
date while production uses September, and the E2E build command has another
hard-coded date. Normalize the actual runtime settings and documentation before
treating those tests as equivalent evidence. Do not introduce a second runner.

### 6. Turn the important mechanical architecture rules into checks

**Medium priority; partial enforcement.** The feature-slice guide requires public
entrypoints and forbids cycles across every feature. Only four of twelve API
features expose `index.ts`; the source graph contains cross-feature deep imports
and an imports/households type-level cycle. The existing
[boundary test](../../scripts/family-feature-boundaries.test.ts) enforces the
family/invitation reference subset. The reference docs acknowledge that limited
adoption, while the general standard reads as universal.

Agree and document the actual domain dependency directions, then enforce those
boundaries using the existing check. Do not generate empty forwarding barrels to
satisfy a filename rule. Curated public APIs should hide meaningful internals.
Use one concise domain/contract/proof map for the remaining features and packages;
do not create another parallel intent-document hierarchy.

Reconcile these specific instructions at the same time:

| Source | Correction |
| --- | --- |
| [TypeScript contracts](../reference/engineering/TYPESCRIPT_CONTRACTS.md), lines 14, 307 and 341 | Remove blanket JSDoc-on-every-export wording; document non-obvious contracts, authority, lifetime and failures. |
| TypeScript contracts, line 24; [feature slices](../reference/engineering/FEATURE_SLICE_ARCHITECTURE.md), lines 101–140 | Direct imports within a feature; curated public imports across features. |
| [Build a form](../how-to/build-a-form.md), line 141 | Feature hooks own mutation lifecycle; screens own draft/navigation state. Match the implemented family reference. |
| [Cloudflare architecture](../reference/engineering/CLOUDFLARE_ARCHITECTURE.md), lines 27, 128, 158 and 200 | Reconcile the universal Drizzle rule with its native-SQL exception; remove the universal `_identity` table checklist. Preserve real storage/provenance guarantees. |
| Feature-slice guide, line 155 | Package builds currently use `tsc`, not the documented `tsdown` default. |
| Web AGENTS versus active legacy CSS | Apply current styling rules to new/touched surfaces and garden older selectors deliberately; do not demand an unrelated whole-app restyle. |

### 7. Strengthen the proof where a real recovery gap escaped

**High priority; source-confirmed correctness finding, not reproduced live.**
[Recipe import](../../apps/web/src/features/recipe-import/recipe-import-page.tsx),
lines 656–675 and 812–836, generates a new idempotency key on each submission. If
the server commits but its response is lost, the page has no intent ID to query,
shows a generic failure and permits a new command. The server's exact-key receipt
works; the browser does not retain the submitted command for replay. The answer,
cancel and confirmation paths also generate fresh keys on resubmission.

The component test checks safe failure text, not commit-followed-by-response-loss.
Make this a focused TDD gardening fix: classify definite versus unknown failures,
retain the exact command for retry/reconciliation, and prove the lost-response
case through the native boundary. Keep source deduplication and the durable
receipts; they are not interchangeable with request identity.

There is no recipe-import Playwright journey in the inspected suite. Expand the
existing feature map to cover import and private discovery, and add representative
observable journey proof. Keep the distinction between a synthetic provider and
real model-quality evidence. A diagram or screenshot cannot replace this proof.

### 8. Curate imported guidance for this stack

**Medium priority; conditional conflicts, not production vulnerabilities.** The
React-performance library is already opt-in for measured problems. Keep that
routing, but remove or correct examples that contradict the actual platform:

- Worker module-scope `fetch` in `server-hoist-static-io.md`.
- Automatic request-cancellation claims and a second remote-state owner in
  `rendering-usetransition-loading.md`.
- Cookie-derived authentication caching in `js-cache-function-results.md`.
- Unowned preload/background work examples that omit explicit failure handling.

Installed Cloudflare skills also contain stock Wrangler source-of-truth and
latest-package instructions, and a Durable Object test example that installs
Vitest 3 while this repo uses Vitest 5 for ordinary tests and Vitest 4 for native
Worker tests. Configure repository guidance to use native
Alchemy, the installed versions and the existing Worker test workspace. Do not
blindly copy vendor setup steps into an established stack. Turnstile's multiple
human handoffs are a conditional future integration issue, not a current blocker.

The proposed pstack/Matt combination needs the same adaptation. Map Matt's tracker
and domain documents to the existing plans, references and decision register;
avoid a second glossary/ADR/task system. Distinguish duplicate `teach` and `tdd`
names. Let approved gardening scope satisfy candidate selection, instead of
stopping each pass for another interview. Keep visual explanations on demand.
Pstack's broad triggers, fixed verification panels and automatic explanation steps
must be reconciled with the chosen risk-proportionate workflow. This is a complete
adoption of the agreed combination, not an unmodified installation of both routers.

Additional shared-skill routing corrections:

- Keep shadcn's established registry and theme within approved work. Its blanket
  “confirm first” update steps should not restart approval already given; preserve
  diffs and review of newly copied third-party code.
- Reserve the separate frontend art-direction skill for that purpose. Its motion
  quota and thesis must not compete with approved Paper designs on routine changes.
- Keep codebase-design's deletion test and alternative interfaces. Map its glossary
  lookup to current domain references, allow real service/API names, and delete
  old tests only when retained tests cover their behavioral guarantees.
- Use ordinary compilation and meaningful tests to validate Effect changes. Some
  supporting references still require a disposable probe for every edit, despite
  the entrypoint limiting probes to unresolved semantics.
- Keep gh-stack as an optional transport tool and Oracle as optional advice.
  Neither becomes the default delivery reviewer or substitutes for current-patch
  verification. Psychopomp already has the desired on-demand scope.
- Reconcile Impeccable's competing Paper, DESIGN.md and built-artifact authority
  statements. Its unversioned home-engine preference and configured hooks were
  inspected as source; hook dispatch and generated runtime instructions remain
  unverified. Do not assume checked-in text proves the loaded engine's behavior.

### 9. Fix persistence and optimize the measured bottleneck

**Persistence defect observed and addressed for this deliverable.** The shared
Git exclude file contains `/docs/`. It hides new documents while modifications to
already tracked docs still appear. The same issue was reported in the September
“Update impeccable skill” chat. The two requested records and their coverage file
are explicitly included in Git for this audit. Remove the broad local exclusion
as a setup change; do not remove intentional secret/runtime exclusions.

**Performance recommendation based on one observed run.** The main CI run linked
above took 8m24s including deployment. Its media-container job took 7m02s, including
5m48s of media verification. The six-minute lifetime proof dominates. Additional
API unit shards will not materially improve that critical path. Keep the lifetime
proof; consider change-aware execution and avoid repeatedly running the same full
suite without new code, failures or unresolved concerns. Measure several runs
before changing CI policy. No demonstrated need exists for a custom CI wrapper.

The private-discovery rubric also points at an obsolete decision path, and its
offline validator is not wired into the normal command/CI checks. Correct the
pointer and connect the existing validator where it provides actual confidence.
Do not invent another evaluation framework.

Two existing structural checks also have inventory gaps. The recipe-import
structure check uses only `git ls-files`, so new untracked sources can escape it
during local work; the existing owned-source helper already handles that case.
That helper itself omits `stacks`, `evals` and the root stack-test config from its
suppression checks. Correct the existing inventories instead of adding parallel
scanners. Normal global lint remains in place.

Production credentials intentionally lack permission to create or replace every
resource declared by the stack. This is not a current deployment failure, but a
future resource change may need a specific capability grant. Report the actual
resource and missing permission; do not broaden credentials automatically or
treat ordinary implementation as blocked by hypothetical provider setup.

## Retrospective evidence

| Chat | Evidence used |
| --- | --- |
| Find shallow modules to delete (this chat) | Repeated requests to continue, review and merge; explicit unsigned commits; selected autonomy/design/gardening agreement. |
| Choose the next reference slice | The user asked about committing/merging work already reported merged; a signing problem was described confusingly. Report the actual blocker and continue with already authorized unsigned commits. |
| Update Alchemy and Effect | Recent testing-tool and browser-mode discussion; used to route verification/tooling inspection, not as current CI proof. |
| Update agent guidance from X post | Questions about orphaned work and stale branches; durable ownership and accurate pickup state matter. |
| Audit skills for GPT-6 Astra | Earlier static audit already identified fixed Impeccable stopping rules and overlapping skill triggers. Several entrypoint fixes now exist; supporting references still need reconciliation. |
| Ideate on agent chat UI | The user found account-recovery UX and chat/list behavior unsatisfactory after code checks. Validate the actual user journey and domain outcome, not only fixtures or attractive screenshots. This work remains active in another checkout. |
| Update impeccable skill | New docs were hidden by Git excludes; the same persistence failure recurred in this audit. |
| Simplify codebase slop | Review caught an upgrade-path defect after passing CI. Preserve independent review and meaningful migration evidence. Historical backfill approval rules are not assumed current. |
| Eng Manager | The user separately prompted PR creation and merge; a large experiment diary was later deleted. Carry agreed delivery through its finish line and retain concise outcomes rather than repeated run diaries. |

Recent relevant turns were selected, not every historical turn in every chat.
No private household transcripts or credential material were copied into this report.

## Adoption order

1. Repair contradictory current guidance and the hidden-docs exclusion. Reconcile
   active plans, runtime commands and skill supporting files. Keep one authority
   for execution, one for domain standards and one for each product decision.
2. Configure the selected pstack/Matt skills, approved-scope autonomy, tracker/domain
   pointers, current model roles and resume state. Chain review, Babysit and
   Shipping. Add appropriate main-branch required checks. Explicitly replace the
   ordinary green AI-candidate human-review policy.
3. Prove one approved change through merge without milestone prompts. Include
   independent review and the appropriate real runtime evidence. Start the full
   month when that setup works; no start date or recurring job is fabricated here.
4. Use the first gardener pass for the import recovery gap, agreed domain-boundary
   enforcement and remaining stale examples. Schedule regular gardening through
   the supported host automation once its repository/target and cadence are set.

Keep domain-driven modeling, feature ownership, Effect contracts, generated
clients, input decoding, account isolation, exact-command recovery, persistence
and migration checks, and risk-matched independent verification. Remove duplicate
instructions and unnecessary human coordination, not these guarantees.

## Verification of this deliverable

The documentation checker passed for 311 Markdown files. The coverage JSON parses,
and the repository Markdown inventory has no missing manifest entry. Diff
whitespace checks passed. An independent synthesis review found no blocking issue;
its clarification of the Paper rule is incorporated above. Oxfmt excluded the
documentation targets, so this report does not claim a formatter pass. No
application or cloud-resource test was run for these documentation-only changes.
