# Household people, profiles and permissions

Status: done
Owner: historical Stage 1 delivery

## Outcome

Represent people who eat separately from authenticated members. Preserve identity,
profile versions and audits across invitations, departure and return, including
managed dependant profiles and cross-household isolation. Stage 1's cumulative
exit was accepted on 2026-09-05 through
[PR #205](https://github.com/cill-i-am/meal-planner/pull/205).

## Evidence by outcome

- [Stable registry and lifecycle](01-person-registry-and-lifecycle.md)
- [Account linking, invitations and departure](02-account-linking-invitations-and-departure.md)
- [Profile authority and audit](03-profile-authority-versioning-and-audit.md)
- [Private-session boundary evidence](04-private-interview-session-boundary.md),
  with the [historical SDK probe](04-agents-boundary-evidence.md)
- [Cumulative membership/profile proof](05-cumulative-exit-proof.md)

## Limits

The boundary probe did not implement model conversation. Organization deletion,
dependant login, full weekly planning and retailer state were excluded. Future
features retain their own [plans](../README.md). Current rules belong to
[household reference](../../reference/household.md) and [private discovery](../../reference/private-discovery.md),
not this completed stage's implementation history.
