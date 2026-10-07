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
| 1 | Complexity enforcement and documentation/evaluation tooling | Verified; delivery pending | Baseline `6581682`. Restored native cccc 1.7.0 setup guidance inside the retained testing skill. Existing gates and domain helpers retained. |
| 2 | Private interview input and session lifecycle | Scouting | Inspect callers and the prior intermittent WebKit input failure; no speculative fix. |
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
