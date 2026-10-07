# Ten additional gardening passes

Requested on 7 October 2026, after PR #289. Earlier passes do not count toward
this goal. Starting remote main is `6581682`, which includes the documentation
reset in PR #291. This file is a delivery record for the requested goal; it does
not restore the removed product or architecture documentation.

Use current source, contracts, tests and retained skills. Preserve domain and
feature ownership, permissions, privacy, consent, persistence and recovery.
Each pass traces callers and applies the deletion test. Count a substantiated
no-op rather than inventing work. Changes require independent review, relevant
verification, required CI, merge and authorized deployment evidence.

| Pass | Area | Status | Outcome and evidence |
| --- | --- | --- | --- |
| 1 | Complexity enforcement and documentation/evaluation tooling | Merged; production pending | PR #292 merged as `2425137`. Restored native cccc 1.7.0 setup guidance inside the retained testing skill. Existing gates and domain helpers retained. |
| 2 | Private interview input and session lifecycle | Verified; delivery pending | Removed duplicated queued and running checks already owned by `isAssistantTurnActive`. Component tests, equivalence review and native browser journeys passed. |
| 3 | Conversation proposals and schedule materialization | Scouting | Check recent complexity refactor and duplicated content lookup rules. |
| 4 | Food Book and meal-planning browser data paths | Planned | |
| 5 | Recipe acquisition and import review | Planned | |
| 6 | Household membership and people lifecycle | Planned | |
| 7 | Provider accounting and recovery | Planned | |
| 8 | Tesco catalogue and retailer adapters | Planned | |
| 9 | Authentication, invitations and account recovery | Planned | |
| 10 | Remaining frontend routes, composition and shared controls | Planned | |

Completed: 0 of 10. Scouting does not count as completion. Scope may be refined
from evidence while keeping ten distinct passes and recording actual coverage.

## Pass 1 evidence

Inspected PR #290's native complexity configuration, lint commands, schedule
materializer and private-output fixture routing, then PR #291's documentation
checker and evaluation validator. The complexity check owns cognitive limits;
the domain helpers retain row matching, capacity, reservation and routing rules.
The validators retain link, fixture, contract, version and provenance checks.
None should be deleted just for being another file or executable entrypoint.

The selected correction addresses verified local setup friction. Cargo installed
cccc 1.7.0 successfully; adding Cargo's bin directory to the invocation path made
`pnpm lint:complexity` pass across 727 files and 11,232 functions, with maximum
cognitive complexity 40 and cyclomatic complexity 38. Configuration is unchanged.
Documentation checks passed all 211 Markdown files and 19 checker tests. Eight
schedule tests, eight evaluation asset tests and skill validation passed.
Oxfmt excludes `.agents` by repository defaults, so it was not counted as
formatting evidence for the reference edit.

PR #292 merged as `24251370e515ea94c5f9af6d8e0a153f8048d7fd`. The
[production deployment](https://github.com/cill-i-am/meal-planner/actions/runs/37679585094)
and [preview cleanup](https://github.com/cill-i-am/meal-planner/actions/runs/37679585454)
were still running when this record was updated. Pass 1 does not count as
completed until production is verified.

## Pass 2 evidence

Traced the private interview page caller, account-bound panel, generation-bound
chat, client admission and recovery, profile loading, proposal review and
correction, browser page object and component tests. Retained generation
ownership, stale-callback rejection, unresolved-request recovery and explicit
safety confirmation because they protect access, privacy and user intent.

The selected deletion removes two repeated active-turn checks from
`private-profile-cards.tsx`. The retained `isAssistantTurnActive` helper already
checks both queued and running turns. Independent review compared 112
combinations of the old and new expressions, with matching results and no
findings. The 36 private interview browser component tests passed before and
after the deletion. Web TypeScript checking, changed-file lint, formatting and
`git diff --check` passed.

The native private review journey passed in Chromium. WebKit initially failed
before reaching the changed private panel while opening the saved food facts
disclosure. Three baseline repeats and three changed-code repeats then passed.
Trace analysis suggests roster loading moved the disclosure during the click,
but the exact event targets and cause remain unproven. Pass 10 retains the
controlled investigation. The earlier empty-input trace is a separate unresolved
failure. This cleanup does not claim to fix either failure.

Pass 2 is rebased onto merged pass 1. Its delivery remains pending independent
review of the final patch, required CI, merge and production verification.
