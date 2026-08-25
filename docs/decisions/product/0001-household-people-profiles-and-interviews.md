# PDR-0001 — Household People, Profiles, And Interviews

- Status: Accepted
- Date: 2026-08-24
- Owners: Household product

## Context

A household contains people who eat and authenticated users who can operate the
product. Those concepts overlap for adults but are not identical. Dependants
need planning profiles without accounts, an invited adult may exist before
accepting an invitation, and the product must preserve a person's planning
history while account state changes.

The AI discovery experience also creates a privacy boundary. The conversation
must be private enough to feel candid, while the resulting household profile
must remain useful and editable by the people planning food together.

## Decision

### People and accounts

- A household person is distinct from an authenticated Better Auth member.
- MVP adults may have authenticated accounts linked to their household-person
  record.
- MVP dependants are managed profiles only and cannot sign in.
- A future dependant account may claim or link the existing profile without
  creating a second person, but that flow is deferred.
- One adult can create the household, add all people, enter provisional
  information, and generate the first plan before invited adults complete their
  own discovery sessions.
- One authenticated user may link to at most one household person within a given
  household.
- The same authenticated user may belong to several households and link to one
  household person in each.
- An incorrect or duplicate account link is repaired through an explicit
  authorized operation. The product does not automatically merge or delete
  household people, and repair must preserve the chosen person's profile,
  routine, plan, feedback, recipe, and audit history.

### Profile visibility and editing

- Confirmed person-profile facts are visible to all adults in the household.
- In the MVP, any adult may directly edit any adult or dependant profile.
- Every profile mutation records who changed it, when, and the change source.
- Granular permissions, suggestions, guardianship roles, and profile-change
  approval workflows are deferred.

### Interviews and repeated review

- An adult's raw interview transcript is private to that participant.
- The transcript is not planning authority and is not required to reconstruct
  confirmed product state.
- An adult may run an AI-led review of their own profile at any time. Discovery
  is not a one-time onboarding wizard.
- Confirmed interview outputs become household-visible profile facts.
- Adults may also update profiles directly outside an interview.
- Profile facts and profile snapshots are versioned so history and plan
  provenance remain auditable.

### Minimum profile for the first plan

The first plan should be available as soon as the product can avoid an unsafe or
obviously impractical recommendation. It does not require an exhaustive profile
or a completed interview from every adult.

Before generating the first plan, the household confirms:

- every active household person who needs food coverage;
- the managed meal occasions for those people;
- a hard-constraint status for each person, including an explicit `none known`
  where appropriate;
- basic weekday location or availability needed to distinguish home, office,
  school, travel, or packed-meal requirements;
- the household's available cooking equipment and realistic cooking-capacity
  boundary; and
- at least one approved fallback for any person who cannot reliably share
  ordinary household meals.

Likes, cuisines, routine detail, exact products, portion refinements, and softer
preferences may remain provisional or be learned in later reviews. The agent
should create visible profile and routine artifacts early and stop asking once
the minimum planning boundary is met, rather than withholding value until a long
questionnaire is complete.

The product will tune interview depth against measured first-plan quality,
correction burden, active time, and abandonment. A fixed questionnaire length is
not part of this decision.

### Provisional and contradictory facts

- Self-confirmed facts normally replace provisional facts entered by another
  adult.
- Likes, dislikes, ordinary routines, and meal habits may update directly when
  self-confirmed information conflicts with provisional data.
- A hard dietary or safety constraint is never silently removed or weakened.
  Removing or weakening it requires an explicit admitted confirmation.
- The planner uses the latest confirmed profile by default.

### Active-plan effect

- Approved plans pin the profile and routine versions used to create them.
- A profile update affects future planning by default.
- During an active week, the product flags meals affected by the change and may
  offer a replan of the remaining period.
- It never silently rewrites an approved plan.

### Inference

- The agent may infer soft, low-weight preferences from repeated behaviour or
  feedback.
- Inferred facts are visible, labelled, editable, and removable.
- Safety constraints, dietary rules, routines, goals, and strong dislikes
  require explicit confirmation before becoming authoritative.

### Departure, archival, and restoration

- Removing an adult's household membership revokes their account access to that
  household immediately.
- A membership removal does not delete the corresponding household person.
  Leaving or removing someone archives their `HouseholdPerson` by default.
- An adult may archive or restore a dependant profile through the same product
  lifecycle.
- An archived person stops generating future meal requirements and their
  routines no longer apply to new plans.
- Historical approved plans, profile versions, feedback, recipe changes, and
  audit records retain stable references to the archived person.
- Remaining authorized adults may continue to understand household history that
  involved the archived person.
- A departed adult cannot read household history after their membership access
  is removed.
- If the person returns, an adult restores the same household-person identity
  rather than creating a duplicate profile and losing history.
- Permanent deletion or erasure is a separate explicit lifecycle. It is not the
  default consequence of leaving a household.

## Consequences

- Better Auth remains the identity and membership control plane rather than the
  complete eater model.
- Household planning state needs stable person identity, account-link state,
  profile versions, mutation audit, and private interview-session boundaries.
- The account-link capability enforces at most one linked person per user and
  household while allowing the user to participate in several households.
- Link repair is an explicit audited identity operation rather than a heuristic
  merge of product records.
- The first-plan gate is a small explicit safety-and-practicality boundary, not
  completion of an exhaustive preference questionnaire.
- Profile and routine artifacts must support provisional state because the first
  plan may precede every adult's self-review.
- MVP permissions are intentionally broad to reduce implementation and household
  coordination friction.
- Private transcript handling cannot be conflated with private profile facts;
  ordinary confirmed profile facts are shared household state.
- Account offboarding and household-person archival are distinct transitions,
  even where one user action coordinates both.
- Historical projections must render archived people without reactivating their
  routines or future meal requirements.

## Deferred

- dependant login and profile claiming;
- granular adult permissions;
- guardian-specific permissions;
- consensus approval of profile changes;
- hidden private confirmed profile facts;
- cross-household person identity or profile portability; and
- the permanent person-data deletion and erasure workflow.