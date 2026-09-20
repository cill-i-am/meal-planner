# Private discovery and repeat profile review

Status: active
Owner: unassigned — next discovery delivery slice
Depends on: [household foundation](../household-people/README.md)

## Outcome and context

An adult has a private adaptive conversation that produces useful profile cards,
can correct and explicitly confirm facts, and obtains an accurate household-visible
profile. Later focused reviews use a new session; completed transcripts remain
private read-only history. Adults can complete a shorter assisted dependant review.

The product owner accepted this bounded outcome and stage-specific evaluation on
2026-09-06. [PDR-0006](../../decisions/pdr-0006-ai-evaluation-and-release-evidence.md#stage-specific-evidence-and-the-complete-beta-gate)
retains all eight scenario families, hard blockers, quality bands and human
calibration. Later routine/planning/repair/shopping dimensions remain not exercised
here; the connected journey is still required before external beta.

## Delivery sequence

Follow the child record for its actual state, evidence and limitations:

1. [Private session foundation](01-private-session-foundation.md).
2. [Progressive cards and confirmation](02-progressive-cards-and-confirmation.md).
3. [Adaptive discovery, remaining evaluation and tone](03-adaptive-discovery-and-evaluation.md).
4. [Repeat review and dependant assistance](04-repeat-review-and-dependant-assistance.md).
5. Cumulative acceptance below, after the child outcomes.

The [current private-discovery reference](../../reference/private-discovery.md)
and [coverage contract](../../reference/discovery-coverage.md) own runtime and
confirmation rules. No new transcript-sharing, dependant account, organization
delete, general chat platform or retailer work belongs to this outcome.

## Cumulative acceptance

- [ ] Two adults independently review/correct profiles; one assists a dependant.
- [ ] A later review changes an ordinary preference through explicit confirmation,
  with profile persistence, versions/audit and closed earlier sessions.
- [ ] The selected real model, UI, admitted commands, native privacy/replay boundaries
  and all eight stage-scoped families satisfy PDR-0006, including actual human ratings.
- [ ] Record exact model, prompt, tool, policy, scenario, rubric and fixed-judge
  versions; privacy-safe telemetry measures burden without retaining transcripts.

## Open decisions and limits

Candidate model/provider and fixed-judge selection must follow quality, cost,
privacy and latency evidence. Whether production experimentation is needed in
invite-only beta remains unresolved; no production model configuration is selected
by this plan. A recorded live opening is not a calibrated baseline. Broader
quality/evaluation was explicitly deferred at the implementation merge, not passed.
