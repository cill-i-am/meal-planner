# PDR-0016 — Support beta households and repair failures

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Decision and reason

Beta participants need an easy contextual way to report problems without
diagnosing code. Keep a durable report with their description and the minimum
opaque household, actor, session, artifact, version, receipt and build identifiers
needed for investigation. Direct support can supplement that record.

Never automatically attach private transcripts, messages, health disclosures,
source evidence or unrelated household content. Additional evidence is optional;
transcript access always requires the separate purpose-specific, time-limited,
revocable and audited participant grant from PDR-0001.

## Incident levels and response

| Level | Meaning and response |
| --- | --- |
| Critical | Credible privacy/isolation/authorization risk, ignored hard constraints, lost/corrupt/contradictory canonical state, invalid approved plans or equivalent threats to safety, privacy or product authority. Immediately block cohort expansion and pause affected operations, capabilities, households or releases as needed. |
| Blocking | An important journey cannot complete, without current evidence of a critical violation. Prioritize restoring the product path. |
| Quality | The journey remains usable but generic recommendations, excessive questions, weak rationale/repair, misleading presentation, poor performance or interaction materially increase work. Group reusable causes into product improvements and regression coverage. |

Reclassify when evidence changes; an initial level proves neither presence nor
absence of a critical failure. Cillian owns MVP beta incidents. Preserve minimal
versions, receipts, audits, logs and participant-provided evidence. Inform affected
participants plainly about known impact, containment and necessary action, without
overstating certainty. Re-enable only after effective containment and correction
are demonstrated. Close critical incidents only after recording cause, affected
scope, containment, correction and required participant communication. Add
deterministic or privacy-safe agent regressions where practical.

Transparent temporary workarounds may help if they preserve invariants and are
recorded as support, not ordinary product success. Recurring support cannot become
the permanent product. Include frequency and intervention type in beta evidence.

## Access and repair

Support is read-only by default and limited to necessary household-visible state,
versions, receipts, audit and operational evidence under the same authorization
boundaries as the product. Operator tooling grants no arbitrary household access.
Private conversations require the accepted specific grant; prefer product state
and participant explanation even when consent is available.

Repair canonical state only with narrow typed, authorized, idempotent and audited
operator commands. Record operator, reason, target household/artifact, expected
version, authoritative result and receipt. Preserve material before/after lineage
where privacy permits, historical versions, approval semantics and audits.
Explain consequential participant-visible changes. Hidden database edits are not
an accepted repair path; missing admitted repair commands are implementation gaps,
not permission to bypass authority.

Keep runbooks, severity definitions, sanitized incidents, regression evidence and
follow-up in repository records. Use opaque identifiers and omit participant
names, private messages, health disclosures, source evidence, credentials and
household free text. Fix PRs state closing regression evidence and may link the
sanitized record. Analytics use only necessary categories/intervention types.

Staffed on-call rotations, multi-operator escalation, contractual response or
resolution times, a public status page, commercial support-platform integration,
automated notification beyond the invite-only need, delegated repair/granular
operator roles and large-scale public-support processes remain deferred.
