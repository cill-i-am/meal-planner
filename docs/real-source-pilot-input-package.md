# Real-Source Pilot Input Package

This is the privacy-safe preparation worksheet for the GAIA-118 pilot. It
contains no source locators and is not an executable manifest. The candidate
set now fills all six required source-class slots, but the run must remain
closed until every runtime-only gate below is proven.

## Fixed Contract

- Stage: exactly `pilot-gaia-118`.
- Budget cap: exactly `10_000_000` micro-US dollars ($10).
- Manifest schema version: `1`.
- Evidence retention: exactly seven days, with deletion verification required
  after the run.
- Import path: the existing authenticated import API and durable workflow only.

## Prepared Six-Source Matrix

The sample IDs are opaque and contain no source, creator, or content
information. The operator keeps the temporary sample-to-locator mapping outside
this repository, Linear, GitHub, logs, reports, and handoffs.

| Opaque sample ID | Source class | Media kind | Note codes | Expected observation |
| --- | --- | --- | --- | --- |
| `sample_7fd2c4a1` | `normal_video` | `video` | none | Recipe success path |
| `sample_b319e65c` | `sparse_description` | `video` | none | Recipe success path |
| `sample_4a8d027f` | `dense_on_screen_text` | `video` | none | Recipe success path |
| `sample_c6519b3e` | `speech_heavy` | `video` | none | Recipe success path |
| `sample_e20f7d94` | `carousel` | `carousel` | none | Recipe success path |
| `sample_95ac31f8` | `expected_failure` | `video` | `expected_failure` | Typed `not_a_recipe` failure |

Prepared manifest ID: `manifest_3e7a9c52`.

Do not infer recipe quality, accessibility, media kind, or authorization from a
candidate label. Confirm each fact through the approved operator process before
building the executable manifest. If a source resolves to a different media
kind or semantic class, stop and replace the candidate or revise the sample
design before execution.

## Runtime-Only Values

Complete these values only inside the explicitly authorized execution window:

- one current authorization route for every sample:
  `creator_owned`, `documented_permission`, or `approved_research_basis`;
- one opaque `auth:` reference plus `authorizedAt` and `validUntil` timestamps
  for every sample;
- one `deleteBy` timestamp for every sample, no later than seven days after the
  run;
- live confirmation that media acquisition, speech transcription, visual
  evidence, and recipe extraction are configured in the exact pilot stage;
- the current preflight time and the approved execution window; and
- the transient mapping from each opaque sample ID to its approved source
  locator.

These values are deliberately absent from this durable worksheet. Do not
fabricate them from local tests, old configuration, candidate availability, or
prior authorization.

## Readiness Checklist

- [x] Six candidate slots cover every required source class.
- [x] Both video and carousel media kinds are represented.
- [x] The semantic failure slot expects `not_a_recipe`, not an acquisition
  failure.
- [x] Opaque sample and manifest IDs are prepared.
- [x] The exact stage and budget are fixed.
- [ ] Every candidate has a current, auditable authorization record.
- [ ] Every candidate's media kind and source class are confirmed.
- [ ] All four provider capabilities are confirmed configured in the exact
  pilot stage.
- [ ] The execution window and current preflight time are approved.
- [ ] Every deletion deadline fits the seven-day retention boundary.
- [ ] The transient sample-to-locator mapping is available only to the operator.

Any unchecked item is a stop condition. This worksheet does not authorize live
source access, provider calls or spend, deployment, infrastructure mutation, or
pilot execution.
