# Real-Source Recipe Quality Pilot Runbook

This runbook prepares the GAIA-118 pilot without executing it. The pilot remains
human-triggered: a final sample set, current provider readiness, a budget cap,
and an explicit execution window are required before any real source or provider
is used.

The executable readiness contract lives in
`apps/api/src/features/pilots/recipe-quality-pilot.ts`.

## What The Contract Guarantees

The preflight fails closed unless:

- the stage is exactly `pilot-gaia-117`;
- every sample has a non-expired authorization record;
- the sample set covers normal video, sparse description, dense on-screen text,
  speech-heavy video, carousel, and expected-failure cases;
- video and carousel identities agree with their declared media kind;
- all four required provider capabilities are explicitly marked configured;
- the budget cap is a positive integer in micro-US dollars;
- evidence retention is exactly seven days and post-run deletion verification is
  required; and
- every sample has a unique opaque ID and a deletion deadline within the
  retention window.

The report builder then requires one terminal observation for every manifest
sample. It rejects missing, duplicate, mismatched, malformed, or over-budget
observations and preserves unknown provider cost as `indeterminate` instead of
inventing a number.

## Privacy Boundary

The durable manifest and report contain:

- opaque sample IDs;
- source and media classifications;
- authorization route plus an internal `auth:` reference in the preflight
  input;
- closed note and failure codes;
- quality measurements; and
- aggregate latency, storage, provider-call, and cost measurements.

They must not contain source URLs, creator names, credentials, authorization
material, raw provider responses, media bytes, transcripts, frames, or extracted
recipe text. The report deliberately removes even the internal authorization
reference.

Keep the temporary mapping from opaque sample ID to approved source locator
outside the manifest and report. Submit each locator only through the normal
authenticated import boundary during an explicitly authorized execution window.
Do not paste that mapping into Linear, GitHub, logs, or handoffs.

## Inputs To Assemble

Before requesting an execution window, prepare:

1. One approved source for each required source class.
2. Random opaque manifest and sample IDs that contain no creator or source
   information.
3. An authorization record for each sample, with:
   - route: `creator_owned`, `documented_permission`, or
     `approved_research_basis`;
   - an opaque `auth:` reference;
   - authorization start and expiry timestamps.
4. A positive whole-number budget cap in micro-US dollars.
5. Current confirmation that media acquisition, speech transcription, visual
   evidence, and recipe extraction are configured in the isolated pilot stage.
6. A deletion deadline for each sample no later than seven days after execution.

Do not claim readiness from stale configuration or from a successful local test.
Provider configuration and authorization validity must be checked at execution
time.

## Future Authorized Execution Sequence

When GAIA-118 receives a specific execution authorization:

1. Resolve the exact deployed revision and isolated stage.
2. Construct the privacy-safe manifest and keep the source mapping transient.
3. Run `runRecipeQualityPilotPreflight` using the current time.
4. Stop immediately on any typed preflight error.
5. Submit the approved sources through the existing authenticated import API.
6. Capture terminal import and review outcomes without copying restricted
   evidence into the report.
7. Record per-sample:
   - end-to-end latency;
   - temporary storage bytes;
   - provider call count;
   - reported or explicitly unknown cost;
   - schema validity;
   - transcript and visual usefulness;
   - first-pass and post-review usability;
   - unsupported facts and invented quantities; and
   - review duration.
8. Build the redacted report with `buildRecipeQualityPilotReport`.
9. Verify that its sample identities reconcile exactly with the manifest.
10. Record the report and the future deletion-verification boundary as durable
    evidence.

This sequence uses the existing import and review path. It does not authorize a
separate ingestion path, direct provider calls, infrastructure changes, or
manual deletion.

## Stop Conditions

Stop without retrying or widening scope if:

- the exact stage, provider configuration, or budget cannot be proven;
- authorization is missing, not active, or expired;
- the required representative coverage is incomplete;
- a source resolves to a different media kind;
- an observation cannot be reconciled to exactly one manifest sample;
- a provider does not report cost—record it as unknown;
- known cost exceeds the cap;
- evidence would cross the privacy boundary; or
- seven-day retention or later deletion verification cannot be preserved.

The separate GAIA-117 retention probe is not part of this pilot and must remain
untouched until its scheduled read-only deletion check.
