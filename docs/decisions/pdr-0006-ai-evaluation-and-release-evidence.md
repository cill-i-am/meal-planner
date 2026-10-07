# PDR-0006 — Evaluate the AI and collect release evidence

- Status: Accepted
- Date: 2026-08-24
- Amended: 2026-09-06 — the product owner accepted stage-specific evaluation:
  discovery/profile quality in Stage 2, with planning and repair evidence in
  their owning later stages and the complete journey required before external
  beta.
- Owners: Household product
- Amended: 2026-10-05. Cillian approved automated evaluation for ordinary green
  candidates with periodic human calibration. This replaces the requirement to
  human-review two green scenarios for every candidate. Initial calibration,
  regression decisions, hard blockers and external-beta acceptance remain.

## Decision and reason

Fluent conversation does not prove useful planning, and deterministic tests cannot
judge perceptiveness. Use three separate forms of evidence: exact domain/software
tests, versioned privacy-safe synthetic agent evaluations, and real beta outcomes.
Offline success cannot replace evidence of time saved, fewer corrections, useful
plans, week-two/week-four return and feeling understood.

## Initial synthetic scenario suite

Keep eight versioned scenario families:

1. Simple baseline that reaches value without exhaustive questions.
2. Conflicting adult work, breakfast, packed-lunch and shared-dinner routines.
3. Dependants with strong avoids and approved exact packaged fallbacks.
4. Vegetarian/omnivore coexistence with compatible shared components.
5. Hard allergens or prohibited ingredients across meals, substitutions and repairs.
6. Repeated routines, intentional skips, eating out and fixed takeaway.
7. Limited cooking capacity, equipment and realistic preparation windows.
8. Batch-cook dependencies and repair of later meals, portions and shopping.

Each fixture states facts to discover, prohibited inventions/outcomes, hard
invariants, expected artifacts/transitions, user changes and its quality rubric.
Evaluate the interaction and at least one revision, not only final JSON. Several
valid plans may pass. Score useful questioning, household specificity, synthesis,
confirmed assumptions, conflicts, practicality, fallback/routine use, truthful
rationale and coherent repair.

## Stage-specific evidence and the complete beta gate

The 2026-09-06 amendment assigns evaluation to the capability that exists:

| Owner | Required scope |
| --- | --- |
| Stage 2, discovery | All eight families' discovery/profile work, useful follow-ups, progressive inspectable proposals, correction, explicit confirmation, privacy, shorter dependant assistance and repeat review. |
| Stage 3, routines | Confirmed routines/fallbacks, expansion, exceptions, conflicts and approved fallback use. |
| Stage 5, planning | Real recommendations, coverage, practicality, rationale, portions, allocations, dependency repair, version impacts and approved remaining-period revisions. |
| Stage 6, learning | Feedback adaptation, visible reversible low-weight inference and less later work. |
| Stage 7, shopping | Approved-plan demand, aggregation, repair/deltas and retained manual/purchased state. |

Declare scope, assertions and applicable rubric dimensions. Record unimplemented
parts as **not exercised**, excluded from pass counts and quality aggregates.
Do not reduce applicability to pass a candidate. Mocked plans, canned repairs and
integration hooks do not establish real capability or end-to-end success.

Before any external beta invitation, all eight families must pass the complete
connected discovery-through-repair journey using real admitted capabilities,
including routines, fallbacks, planning, rationale and shopping consequences.
Exercise all required dimensions. The product owner accepts the full baseline
and the independent calibration below must be complete.

## Release gating and judges

Meaningful model, prompt, tool, policy or agent-behaviour changes run relevant
deterministic tests and synthetic evaluations. Record exact model, prompt, tool,
policy, scenario and rubric versions. Compare providers against this suite;
provider choice does not define the domain. Keep scenarios small enough to rerun.

Hard blockers cannot be waived or offset by averages: deterministic invariant,
safety, privacy, authorization or isolation failures; missing valid coverage;
invented confirmed facts; hard-incompatible meals; missing/incorrect required
fallbacks; invalid, duplicate or overdrawn allocations; silent approved-state
rewrites; and any prohibited scenario outcome.

Use deterministic judges for objective facts, artifacts, authority, coverage,
allocations and repair. Measure questions/repetition, latency, tool/schema
failures, tokens and estimated cost programmatically. A fixed, versioned model
judge scores subjective quality only after hard checks pass. Record its model,
prompt, rubric and version with each result. It cannot downgrade
or compensate for a hard failure. Agents may investigate, fix and reevaluate
failures without fresh human permission, retaining original failure evidence.

The product owner decides close calls and any known quality regression. An
accepted regression requires a PR record of the affected scenarios, exact
regression, reason to ship, absence of hard failures, evidence and follow-up or
monitoring. Material scenario, rubric, prohibited-outcome or scoring changes are
reviewed repository changes. Never weaken the suite just to pass a candidate.

## Non-hard quality bands

Use a five-point rubric for household specificity, first-plan practicality,
profile/routine synthesis, rationale and repair, as applicable to the stage.

| Result | Requirement |
| --- | --- |
| Green | Every applicable critical dimension is at least 4/5, with no meaningful baseline regression. |
| Review required | Any critical dimension is 3/5, drops at least 0.5 from baseline, or questions, latency, reliability, tokens or estimated cost materially worsen. |
| Do not release by default | Any critical dimension is below 3/5, or several valid scenarios are clearly generic, impractical or burdensome. |

Compare both absolute bands and the human-accepted versioned baseline. A non-hard
red result requires the documented product-owner override; no override waives a
hard blocker.

## Human calibration cadence

- The product owner manually scores each stage's initial canonical fixture from
  all eight families across every applicable critical soft dimension. Record
  applicability, scores and brief reasons with scenario/rubric versions. The
  complete baseline is required before external beta.
- Before external beta, a second human independently scores at least two
  representative scenarios, one straightforward and one involving complex
  dependencies, exceptions or repair. Resolve material differences in rubric,
  baseline or judge policy before external use.
- Ordinary green candidates may proceed through independent agent review and
  release without fresh human scoring when real evaluations pass against that
  baseline and calibration is current. Offline asset validation alone is not
  evaluation evidence.
- In each calendar month with candidate releases, the owner scores two rotating
  green scenarios across applicable critical dimensions. Cover all eight before
  repeating a pair. The initial baseline counts for its month; in later active
  months, finish calibration using actual candidate evidence before the first
  candidate release.
- A candidate still needing release with a critical soft score of 3/5 or lower,
  a meaningful regression or an override needs owner review. Agents may first
  fix and reevaluate it.
- Changing the judge model/prompt, rubric, prohibited-outcome policy or scoring
  rules requires new human review of all eight scenarios before using the
  changed judge as release evidence. Review the full suite again before each
  beta cohort expansion.
- Record human/model scores, reviewer identity or role, calibration-set version,
  disagreements and resolutions without private household data. Material
  disagreement, unexplained drift or systematic leniency blocks judge reliance
  until human recalibration and revalidation. Human review cannot waive blockers.

## Eval harness implementation spike

Stage 2 includes a bounded `@vercel/agent-eval` spike before package adoption or a
bespoke harness. Alongside adaptive-questioning work, register the real private
conversation runtime through its custom-agent boundary. Run at least one
representative multi-turn discovery, proposal, correction, admitted confirmation,
completion and new repeat-review scenario.

Assess repeatability/fingerprinting, deterministic artifact/tool/transcript
assertions, turn/tool/failure/latency/cost telemetry, a separately pinned judge,
readable results and suitable local/hosted isolation. Reject adoption if coding-
agent or filesystem assumptions require an unnatural Cloudflare wrapper, break
private thread semantics or duplicate scenario/result authority. Record shared
planning and full-journey needs as unexercised until owning stages prove real
extensions. Keep scenario/rubric/evidence formats package-independent; useful
ideas can survive rejection of the package.

Vercel Run SDK is not selected. Untrusted generated-code execution is not a
current typed-tool-loop requirement; reconsider only after an accepted code-mode
capability needs it. Exact fixtures, models/providers, final harness adoption and
production experimentation remain deferred.

Maintain synthetic assets in the repository. Turn reusable production failures
into privacy-safe regressions where practical. Never copy private transcripts or
identifying beta data into fixtures. Easier scenarios require explicit review
and explanation.
