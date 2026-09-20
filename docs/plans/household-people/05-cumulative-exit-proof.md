# Cumulative people/profile proof

Status: done
Owner: historical delivery in PR #205

## Outcome

An adult's profile belongs to their stable household person, not to a particular
invitation or membership. Information recorded before they join survives account
linking. Departure and return preserve the same person, facts, immutable profile
versions, and audit history, while current membership and linkage determine
whether that adult may read or confirm the profile.

## Acceptance preserved

These are the checks recorded when this work was completed, not new workflow
steps. For a new assignment, read the current contracts.

- [x] Both extended real-runtime tracers pass locally; exact-head review accepted.
- [x] Existing household boundary suite passes, including outsider profile read,
      history, audit, and mutation denial.
- [x] Existing browser-operation and panel tests pass for roster/link/departure
      and profile edits, safety confirmation, unresolved commands, and reauth.
- [x] Root check, lint, formatting, tests, build, and diff check pass locally.
- [x] Hosted CI passes on the frozen head.
- [x] Independent exact-head review is accepted by the orchestrator.

Browser tests prove the shipped interaction contracts; the real runtime suite
proves authenticated authority and persistence. No new full-browser authenticated
journey or live-cloud test is claimed. No cloud, provider, deployment, retailer,
or real-email operation is authorized or required here.

## Delivery evidence

Delivered by [PR #205](https://github.com/cill-i-am/meal-planner/pull/205).
The [original complete record](https://github.com/cill-i-am/meal-planner/blob/1912513fefd35c009c09168035b9c0e0b872c1fb/docs/delivery/stages/01-household-people/05-cumulative-exit-proof.md) keeps the tested commits, checks, decisions, findings, and limits. The docs refactor
did not rerun those tests or change what they proved. This completed record does
not assign new work.

Use [current household contracts](../../reference/household.md) and
[private-discovery contracts](../../reference/private-discovery.md)
for new changes rather than following the old implementation diary.
