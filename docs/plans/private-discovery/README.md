# Private discovery and repeat profile review

Status: active
Owner: unassigned — next discovery delivery slice
Depends on: [household foundation](../household-people/README.md)

## Outcome and context

Adults use a private conversation to create profile cards, correct them, and
confirm the facts to share with the household. A later focused review uses a new
session. Earlier completed transcripts stay private and read-only. Adults can
also complete a shorter guided review for a dependant.

The product owner accepted this work and its stage-specific evaluation on
2026-09-06. [PDR-0006](../../decisions/pdr-0006-ai-evaluation-and-release-evidence.md#stage-specific-evidence-and-the-complete-beta-gate)
still requires all eight scenario families, failure checks, quality scores, and
human calibration. This stage does not test routines, planning, repair, or
shopping. The complete connected journey must still pass before external beta.

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

Choose the model, provider, and fixed judge using quality, cost, privacy, and
latency results. Whether the invite-only beta needs production experiments is
still undecided. This plan selects no production model configuration. One
recorded live opening is not a calibrated baseline. The implementation merge
explicitly deferred broader evaluation; it did not pass it.