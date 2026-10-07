# Autonomous delivery and codebase gardening

Status: active
Progress: initial adoption merged and deployed; weekly gardening enabled; calibration amendment delivered in PR #282
Owner: Codex, with Cillian owning product direction
Decision date: 2026-10-04
Delivery: implement confident adoption changes through merge; return unresolved policy decisions

## Agreed operating model

Cillian wants to work at the level of domains, their responsibilities, and their
interactions. Agree the intended outcome, architectural direction, important
trade-offs, and verification criteria together. After that agreement, the agent
owns implementation and delivery through merge: TDD, independent reviews,
verification, fixing findings, PR creation, CI monitoring, conflict resolution,
and merging when the required checks and reviews pass. Routine implementation
decisions and repeated review rounds do not require another human prompt.

Return to Cillian when evidence requires a material change to the agreed product
direction or domain responsibilities, or when a real blocker cannot be resolved.
The approved scope does not cover unrelated external actions. Existing deployment
authorization and the repository's delivery pipeline remain relevant to the
requested endpoint.

Pstack is the execution workflow. Matt Pocock's skills support design, learning,
review, and improvement. This is an intentional combination, not a claim to run
either upstream system unchanged.

## Skill responsibilities

| Responsibility | Selected method |
| --- | --- |
| Challenge and agree direction | Matt's `grill-me`, `grill-with-docs`, and shared `grilling` |
| Domain language, ownership, and decisions | Matt's `domain-modeling`, using this repo's canonical references and decision register |
| Module depth and interfaces | Matt's `codebase-design`, including deletion tests and alternative interface designs |
| Find gardening candidates | Matt's `improve-codebase-architecture` |
| Resolve uncertain design behavior | Matt's `prototype` and pstack's executable design exploration |
| Capture approved work | Matt's `to-spec` and `to-tickets`, configured for repository-based planning |
| Build, verify, review, and merge | Pstack's implementation, review, verification, babysit, and shipping workflows |
| Review standards and intended behavior separately | Matt's `code-review`, coordinated within automated review |
| Improve the agent environment | Matt's `retro` and `writing-for-agents`, with pstack's structural correction methods |
| Learn a topic over time | Matt's `matt-teach` |
| Understand a particular change or subsystem | Pstack's `teach`, `how`, and `why` |
| Present a PR | Matt's `pr` and relevant observed evidence |
| Re-explain an unclear answer | Matt's `wait-what` |
| Hard bugs or large unresolved projects | Matt's `diagnosing-bugs` and `wayfinder`, when the task warrants them |

Include `setup-matt-pocock-skills` and referenced resources so the selected skills
can operate. Resolve duplicate names such as `teach` and `tdd` explicitly. Choose
model roles from the models and reasoning efforts actually available on the host.
Pstack's babysit workflow ends at merge-ready; the approved delivery workflow must
continue into shipping without another request to merge.

## Gardening and explanations

Move quickly while keeping behavior, access, persistence, and data-safety
guarantees. Accept limited implementation debt and remove it deliberately through
regular gardening: dead code, unnecessary forwarding modules, duplicate paths,
shallow interfaces, stale docs, and recurring mistakes. Within an agreed gardening
scope, agents own the cleanup PRs through review and merge. Changes to domain
meaning or ownership return to the architectural discussion when they exceed the
agreed direction.

Use retrospectives to improve the tools and environment producing the code. Prefer
structural fixes, types, lint rules, and meaningful regression checks for recurring
mistakes; reserve prose rules for decisions that require judgment.

Provide domain-level diagrams, Ben-style interactive walkthroughs, or Psychopomp
videos when Cillian wants to inspect the system. Explain ownership, interactions,
and important state transitions first. These explanations are distinct from
runtime verification evidence. No visual artifact is required for every PR.

The maintenance cadence is cleanup during normal delivery plus a weekly focused
gardener sweep. On 5 October 2026, Cillian explicitly approved the recurring sweep
and verified cleanup merges. The Codex heartbeat `meal-planner-weekly-gardening`
is active in this task for five Monday-morning runs, from 5 October through
2 November. Its first heartbeat was received on 5 October 2026 at 09:02 UTC.
It implements maintenance within existing domain behavior, with independent
review, required CI and merge. Material product decisions still return to Cillian. The fifth sweep includes a workflow
retrospective, and the automation ends within the month-long trial.

The 5 October gardening pass used PR #282 baseline `3f53ba75`, with no source
changes since its delivery that morning. It followed the recent twenty-pass
design review and PR #281's import-recovery fix. The pass checked imports,
provider accounting, source-inventory helpers, feature-boundary checks and the
evaluation validator.
No new production-code refactor was justified. The existing provider accounting
paths, carousel integrity rules and checks remain useful. This was a bounded
follow-up to the completed coverage review, not another whole-codebase
correctness audit.

The user-requested 7 October pass followed the new agent-led journey in PRs
#284 and #285, using baseline `8eee95c`. Proposal review reuses the existing
meal-plan coverage identity. The apparently identical conversation dispatch
branches remain because the generated client requires narrowed action variants.
The pass also reproduced a chat race: the composer accepted another message
before the completed turn's canonical refresh arrived, sending an old version
and receiving HTTP 409. A delayed-response browser regression covers the refresh
boundary. The fix uses the existing query's fetch state to block chat submission
until the current conversation is available. Saved-action recovery and the
browser plan projection keep their existing responsibilities. This additional
pass does not consume a weekly scheduled run. The delayed-refresh regression
failed before the fix and passed afterward. Local verification passed all 14
Chromium/mobile WebKit family and planning journeys, 297 web tests, web typecheck,
focused lint/format checks and documentation validation.


The second user-requested 7 October pass used baseline `8731550` and inspected
meal content, routines, planning and the Food Book. The planner now uses meal
content's existing exact option lookup instead of maintaining two duplicate
helpers. The plan service saves the version already repaired, pinned and
validated by the kernel instead of rebuilding its pins a second time. Domain
ownership, validation, persistence and retry identity stay unchanged. Food Book
presentation and recovery seams remain because they own useful behavior.
Verification passed 29 content, routine and planner tests, API typecheck and
focused lint/format checks, all four Chromium/mobile WebKit planning journeys,
and documentation validation. This additional pass does not consume a weekly run.


The third user-requested 7 October pass used baseline `ecca73d` and inspected
conversation handling and its UI adapters. It removed an unused conversation
namespace adapter, its two types and their public re-exports. Production uses
the host's async namespace interface and the live Worker binding; both stay in
place. Confirmation, account isolation, replay and recovery behavior are unchanged.
The scan retained the stateless action-result RPC because removing it would
require a separate change to the active host/Worker protocol. Verification passed
27 conversation tests, the native Worker bundle export test, API typecheck,
all 14 Chromium/mobile WebKit family and planning journeys, focused lint/format
checks and documentation validation. This additional pass does not consume a
weekly run.

The fourth user-requested 7 October pass used baseline `83d4c4b`. It removed the
conversation Agent's stateless action-state RPC. A feature-owned pure projection
now serves both the host response and stored conversation reads. The host no
longer sends an execution receipt back across the RPC boundary solely to format
its browser state. Durable admission, step completion, rejection and unknown
outcomes still belong to the Agent; the same command identities drive recovery.

Verification passed 36 conversation tests, API typecheck/build, independent
review, all 16 Chromium/mobile WebKit family, planning and private-review
journeys, focused lint/format checks and documentation validation.

The pass also inspected the preceding production run's private-review WebKit
timeout. The trace shows an empty message field after fill, no chat submission,
and a profile read completing during the fill. That timing is a hypothesis,
not a demonstrated cause. A controlled profile-response/input experiment is the
next useful diagnostic; no speculative UI fix or weakened test was added.
This additional pass does not consume a weekly run.

## Adoption and current audit

Commit to this workflow for a month once setup works, then keep what works and
discard what does not. The audit is complete. The implementation assignment covers
the confident corrections and end-to-end delivery; uncertain product policy returns
to Cillian after the independent work is finished.

Audit evidence and coverage are recorded in
[the workflow audit](../research/2026-10-04-agent-workflow-audit.md).

Acceptance for subsequent setup:

- [x] Pstack installed through the native Codex plugin manager; nineteen selected
  Matt skills and dependencies are project-owned copies. All twenty-five local
  skill entrypoints pass Codex structural validation. New-turn automatic discovery
  remains distinct from direct loading in the current session.
- [x] Pstack owns execution; `matt-teach` is distinct from pstack's explainer;
  pstack owns TDD. Existing repository plans and domain references are configured.
- [x] Routine implementation/review/design decisions reuse approved scope.
- [x] Verification guidance names the actual native commands and runtime settings.
- [ ] On-demand explanations show real domains and their interactions.

[PR #281](https://github.com/cill-i-am/meal-planner/pull/281) merged on 5 October
2026 in Dublin. Its [production CI and Alchemy deployment](https://github.com/cill-i-am/meal-planner/actions/runs/37243664026)
passed. The month-long trial runs from that merge through 5 November 2026.

## Implementation and remaining decisions

The active root instructions route agents through the feature map and pstack.
Stale onboarding/runtime instructions and conflicting skill references have been
removed or corrected. The existing offline evaluator now runs with normal checks;
source inventories include new files and the intended owned directories. Native
tests share production compatibility settings. Recipe-import recovery retains
the original submitted command when its outcome is unknown.

Pstack is pinned to the reviewed Codex port below. Current-host model roles are in
`~/.codex/pstack-models.md`; unavailable models must be resolved against the host.
Matt's source revision and license are tracked beside the local skills. Their
Codex invocation policies are preserved in `agents/openai.yaml`. The local Git
exclusions that hid new docs and README files were removed; secret/runtime
exclusions remain.

Cillian approved replacing per-candidate green human scoring with automated
evaluation and periodic human calibration on 5 October 2026. The amendment was
delivered in [PR #282](https://github.com/cill-i-am/meal-planner/pull/282), whose
[production run passed](https://github.com/cill-i-am/meal-planner/actions/runs/37268383611).
The amended [PDR-0006](../decisions/pdr-0006-ai-evaluation-and-release-evidence.md#human-calibration-cadence)
owns that policy. The initial human ratings remain unfulfilled, and the existing
offline validator is not a model evaluation runner. Whole-application domain
dependency changes still require agreement on the intended ownership.

The Impeccable native engine still emits old process instructions. The maintained
skill explicitly makes those subordinate to repository/user/host authority, and
its reproduction is recorded in the skill doctor reference. Hook dispatch and
fresh-host discovery are not claimed verified by static validation.

## Source snapshots reviewed

- [Matt's skills](https://github.com/mattpocock/skills/tree/24fe0ef7737efae15c87225755e9f6f5965e4888), version 1.3.1.
- [Lauren's pstack](https://github.com/cursor/plugins/tree/e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a/pstack), version 0.15.9.
- [Pstack Codex port](https://github.com/ScriptedAlchemy/pstack-codex/tree/e68a46d430d0427d9a7a7f0fb04f42bc63f62fe9), pinned to upstream 0.15.5.
- [Verification guide](https://x.com/poteto/status/2094457600259842065),
  [design guide](https://x.com/poteto/status/2097732320606507506), and
  [Ben's visual walkthrough](https://x.com/BHolmesDev/status/2106829942206173497).

The Codex port's package and file-coverage validators passed during evaluation.
Installation and source checks are complete; the delivery acceptance above is
closed only with actual review, CI and merge evidence.
