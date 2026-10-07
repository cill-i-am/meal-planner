# PDR-0001 — Household people, profiles, and private interviews

- Status: Accepted
- Date: 2026-08-24
- Owners: Household product

## Decision and reason

People who need meals are not the same as account holders. Keep household-person
identity separate from Better Auth membership so dependants and invited adults
can retain profiles and planning history without accounts.

- MVP dependants have managed profiles and cannot sign in. One adult may provide
  provisional information for everyone and obtain a first plan before other
  adults finish discovery.
- A user may link to at most one person per household and belong to several
  households. Explicit authorized link repair preserves the chosen person's
  profile, routine, plan, feedback, recipe and audit history. Never merge or
  delete people heuristically.
- Confirmed profiles are visible to all household adults. Any adult may edit any
  adult or dependant profile in the MVP. Version facts and snapshots and record
  actor, time and source for every change.
- Raw interviews are private to their participant. They are neither planning
  authority nor necessary to reconstruct confirmed product state. Adults may
  review their own profile repeatedly or edit it outside an interview.

## Completed interview lifecycle

An active interview continues until its participant completes it. Completion
permanently closes conversation and product mutations. Retain the transcript as
private, read-only history for that currently authorized participant; a later review starts a new
session. Normal completion does not automatically erase transcripts. Permanent
deletion and erasure are separate lifecycles.

Support and product staff have no default transcript access. The participant may
grant read-only access to one named completed transcript for an explicit purpose.
The grant is time-limited, revocable and audited. It grants no other-session or
household-wide visibility, cannot reopen the interview or mutate product state,
and does not replace ordinary confirmation of any suggested enduring change.

## Minimum profile for the first plan

Confirm only what prevents an unsafe or obviously impractical recommendation:

- active people and their managed meal occasions;
- each person's hard-constraint status, including explicit `none known`;
- basic location and availability for home, school, office, travel or packed food;
- available equipment and realistic cooking capacity; and
- at least one approved fallback for anyone unable to share ordinary meals reliably.

Likes, cuisines, detailed routines, exact products and portion refinements can
remain provisional. Make useful understanding inspectable early and stop asking
when this minimum is met. Tune discovery depth using first-plan quality,
corrections, active time and abandonment, without a fixed questionnaire length.

Self-confirmed ordinary facts replace provisional input. Never silently remove
or weaken a hard dietary or safety constraint. That requires explicit admitted
confirmation. Soft inference from repeated behaviour may affect ranking only at
low weight and must remain labelled, visible, editable and removable. Safety
constraints, dietary rules, routines, goals and strong dislikes require explicit
confirmation.

Use current confirmed profiles for new plans. Profile changes affect future
planning by default; flag effects on an active week and offer remaining-period
replanning. Approved plans retain their pinned profile and routine versions
until a proposed revision is accepted.

## Departure and deferred scope

Membership removal immediately revokes household access and archives the person
by default; it does not erase them. Adults may archive or restore dependants.
Archived people and their routines create no future meal requirements, while
historical references remain stable and available to remaining authorized
adults. A returning person reuses the same identity. Permanent erasure is separate.

Dependant login and claiming, granular or guardian permissions, profile-change
consensus, hidden confirmed profile facts, cross-household identity and profile
portability, and permanent-erasure workflows remain deferred.
