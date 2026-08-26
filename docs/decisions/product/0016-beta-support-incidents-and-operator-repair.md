# PDR-0016 — Beta Support, Incidents, And Operator Repair

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Context

The invite-only beta is intentionally small and closely supported. Participants
need a simple way to report that a profile, conversation, plan, recipe import, or
shopping list is wrong without diagnosing the underlying architecture.

Support must not weaken the privacy and authority boundaries accepted elsewhere.
A support operator should not gain implicit access to private transcripts, and a
quiet database edit must not make a broken product journey appear successful.
The beta also needs a consistent way to distinguish a severe product incident
from a blocked workflow or an ordinary quality problem.

## Decision

### Contextual problem reporting

- The product provides one clear **Report a problem** action from the relevant
  profile, conversation, plan, recipe import, shopping list, or other supported
  artifact.
- A report includes the participant's description and may attach opaque
  household, actor, session, artifact, version, command-receipt, and application-
  build identifiers needed to investigate the problem.
- A report does not automatically attach a private transcript, raw private
  message text, health disclosure, imported source evidence, or unrelated
  household content.
- A participant may explicitly provide additional evidence where the product
  offers that choice. Transcript access still requires the separate explicit,
  purpose-specific, time-limited, revocable, and audited grant accepted in
  PDR-0001.
- Direct support messages may supplement the in-product report, but the report
  record remains the durable correlation point for investigation and follow-up.

### Incident levels

The MVP uses three practical incident levels.

#### Critical

A critical incident includes a confirmed or credible risk of:

- private or cross-household information exposure;
- an authorization or membership-isolation failure;
- a known hard constraint being ignored or weakened;
- corrupted, lost, or internally contradictory canonical household state;
- an approved plan that is structurally invalid as represented; or
- another failure that can materially undermine participant safety, privacy, or
  trust in product authority.

#### Blocking

A blocking incident prevents the household from completing an important journey,
such as onboarding, interview completion, planning, revision, approval, recipe
admission, or shopping-list use, without current evidence of a critical privacy,
authority, or hard-constraint failure.

#### Quality

A quality incident leaves the workflow usable but materially weaker than the
product bar, including generic recommendations, excessive or repeated questions,
confusing rationale, poor repair, misleading presentation, weak performance, or
an interaction problem that increases household effort.

Severity may change as evidence develops. Initial classification is not treated
as proof that a critical failure did or did not occur.

### Critical-incident response

- Cillian is the incident owner for the invite-only MVP beta.
- A critical incident immediately blocks cohort expansion and may require the
  affected operation, capability, household, or release to be paused while the
  risk is contained.
- The product preserves the minimum evidence needed to investigate, including
  versions, receipts, audit records, relevant logs, and participant-provided
  context, without copying private content into broad analytics or repository
  records.
- Affected participants are informed plainly about the known impact, current
  containment, and any action they should take. The product does not overstate
  certainty while investigation is incomplete.
- Re-enabling affected behaviour requires evidence that containment and the
  corrective change are effective. Where practical, the failure becomes a
  deterministic regression test, a privacy-safe synthetic agent scenario, or
  both.
- A critical incident remains open until its cause, affected scope, containment,
  corrective action, and required participant communication are recorded.

### Blocking and quality response

- Blocking incidents are prioritized because a repeatedly assisted workaround is
  not a complete product path.
- A temporary workaround may be used when it is transparent, does not weaken an
  invariant, and is recorded as support intervention rather than ordinary
  product success.
- Quality incidents are grouped by reusable failure class. Repeated issues become
  product changes, usability work, deterministic tests, or agent-eval scenarios
  rather than permanent bespoke support.
- Support frequency and intervention type remain part of beta evidence so direct
  operator help cannot silently improve time-to-plan or correction metrics.

### Support access

- Support access is read-only by default and limited to the household-visible
  artifacts, structured product state, versions, receipts, audit history, and
  operational evidence needed for the reported issue.
- Private interview or chat transcripts are unavailable unless the participant
  grants the accepted transcript-specific access.
- Support tooling enforces the same household authorization and privacy
  boundaries as the product. An operator interface is not permission to query
  arbitrary household data.
- Support should prefer product state and participant explanation over raw
  conversation review even when transcript access has been granted.

### Canonical-state repair

- Canonical household state is repaired only through a narrow, typed, authorized,
  idempotent, and audited operator command.
- A repair records the operator, reason, target household and artifact, expected
  version, authoritative result, and receipt. Material before-and-after state or
  lineage remains inspectable where privacy permits.
- A repair must preserve approved-plan, recipe-version, audit, and historical
  semantics rather than rewriting history as though the error never occurred.
- Invisible production database edits are not an accepted beta support path.
- If a required repair cannot be expressed through an admitted command, that is
  a product and operational gap to implement and test; it is not permission to
  bypass the authority boundary.
- Participant-visible state changes caused by a repair are explained where doing
  so is relevant to trust or subsequent household action.

### Repository and privacy practice

- The repository contains the support runbook, severity definitions, sanitized
  incident summaries, regression evidence, and follow-up work needed for the
  beta.
- Repository records use opaque incident identifiers and must not include
  participant names, private transcript text, raw health disclosures, recipe
  source evidence, credentials, or private household free text.
- Implementation pull requests may link to a sanitized incident record and must
  state the regression evidence used to close it.
- Product analytics record incident category and support-intervention type only
  at the minimum granularity needed for beta learning.

## Consequences

- The product needs contextual problem-report contracts and a privacy-safe
  operator support projection.
- Support tooling must remain subordinate to household authority and transcript
  privacy.
- Operator repair requires explicit command design, receipts, audit, and tests;
  direct database mutation cannot become an undocumented escape hatch.
- Beta metrics need to distinguish self-service success from assisted completion
  and temporary workarounds.
- Critical failures feed both incident response and the deterministic or agent-
  eval regression suite.
- Cohort expansion remains evidence-based and is blocked by unresolved critical
  incidents according to PDR-0015.

## Deferred

- a staffed on-call rotation or multi-operator escalation hierarchy;
- contractual response-time or resolution-time service levels;
- a public status page;
- integration with a commercial customer-support platform;
- automated participant notification beyond the invite-only operating need;
- delegated repair roles and granular operator permissions; and
- support processes for public self-service or large-scale production use.
