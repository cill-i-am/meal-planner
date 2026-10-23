# Recipe evidence acquisition

Verified 23 October 2026. This acquisition change is independent of the recipe-model comparison in [recipe-extraction.md](recipe-extraction.md).

## Decision and supported behavior

Submit every prepared source frame to the existing Scout visual provider in one accounted invocation. Preparation produces three frames; the evidence boundary retains its existing maximum of 12 frames, 1 MiB per frame and 6 MiB total. Use one 100,000-microUSD reservation and report one model call. Do not replace the production recipe model with an experimental provider.

The visual tool response has one positional slot per submitted image. The adapter ignores provider frame indices, timestamps, regions and transport metadata. It assigns each slot the corresponding verified source frame and timestamp. Missing or extra slots produce empty visual evidence rather than shifting observations onto another frame. An empty slot stays in place. Total observations remain bounded at 256. See [adapter](../../apps/api/src/features/imports/import-provider-visual.ts), [response boundary](../../apps/api/src/features/imports/import-visual-evidence-extractor.ts) and [pipeline](../../apps/api/src/features/imports/import-visual-evidence.ts).

New visual manifests use version 2 and account for all submitted bytes and frames. Version 1 retains its existing middle-frame accounting during verified recovery. Both reject mismatched observations and source identity. See [store](../../apps/api/src/features/imports/visual-evidence-store.ts).

## Corpus rationale

The existing development corpus contains `caption-complete` (caption without transcript), `visual-only` (written visual observations from a silent-video scenario), and `silent-unobserved` (no supplied evidence despite intended visual facts). These cases distinguish a usable alternate evidence source from a missing acquisition result. They justify testing caption/visual continuation and explicit abstention when evidence is missing. They are authored synthetic text, not OCR captures; no acquisition-score improvement is inferred from them. The corpus and holdout content were not changed for this acquisition implementation. [Corpus](../../evals/recipe-extraction/corpus.v1.json).

## Primary-source contract

Cloudflare documents Scout vision and function calling, with a 131,000-token context window. Its model schema accepts image parts in the message-content array and requires data-image URIs. The schema publishes no image-count or image-byte ceiling; this is not evidence of unlimited runtime capacity. The application therefore preserves its own byte and frame bounds. [Scout documentation](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/), [model schema endpoint](https://developers.cloudflare.com/api/resources/ai/subresources/models/subresources/schema/methods/get/).

The installed Alchemy 2.0.0-beta.83 serializer (`node_modules/alchemy/src/Cloudflare/AI/LanguageModel.ts`, `toUserMessage`) preserves image-array order, gathering text before all images. The implementation uses one instruction followed by ordered images, so it does not depend on interleaved label/image adjacency. The live probe below exercised that message shape.

Cloudflare publishes $0.27 per million input tokens and $0.85 per million output tokens for this model. A reservation calculation using 131,000 input and 8,192 output tokens is 42,334 microUSD, below the existing 100,000-microUSD reservation. This calculation is a planning bound derived from documented context and the configured output limit, not invoice evidence. [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## Accounted synthetic probe

One live request used three generated JPEGs containing distinct text. It passed through the persistent native D1 accounting runner before Cloudflare invocation. The request and response identity hashes were matched before settlement. The probe used the same ordered-images prompt, forced tool and exact three-slot schema as the adapter.

| Measurement | Observed result |
| --- | --- |
| Dispatch | `visual-allframes-probe-v1` |
| Request SHA-256 | `2200208b0645b0b9b1ab1981eff669920857dc61483b33c62a62c13e03151208` |
| HTTP status | 200 |
| Image 0 / returned slot 0 | `2 onions` |
| Image 1 / returned slot 1 | `Simmer 10 minutes` |
| Image 2 / returned slot 2 | `Serve with rice` |
| Provider invocations | 1 |
| Reported input / output tokens | 2,235 / 54 |
| Recorded request latency | 5,281 ms |
| Reservation | 100,000 microUSD |
| Token-priced settlement | 650 microUSD: `ceil(2235 × 0.27 + 54 × 0.85)` |

The model omitted confidence. The adapter preserves the observed text, normalizes missing confidence to zero, and reports `low_confidence`; it does not invent certainty. The sanitized response retains both native and OpenAI tool-call envelopes for the [regression fixture](../../apps/api/src/features/imports/import-provider-visual.scout.test-fixture.ts) and [adapter test](../../apps/api/src/features/imports/import-provider-visual.test.ts).

This proves three-image acceptance and correct slot attribution for one simple synthetic request. It does not measure recipe accuracy, real-video OCR recall, production latency distribution, holdout scores, or an improvement over another recipe model. Token-priced spend is estimated from provider usage, not a billing invoice. No additional model call was used to make the regression fixture.

## Absent or unusable speech

The source probe now accepts valid video without an audio stream. Native remuxing makes the audio stream optional; provider preparation re-probes the actual registered file and skips audio extraction only when the validated audio-stream list is empty. It still prepares the visual frames. A declared audio stream whose extraction fails remains a failure. See [validation](../../apps/api/src/features/imports/import-media-validation.ts), [remuxing](../../apps/api/src/features/imports/import-media-acquirer.container.ts) and [preparation](../../apps/api/src/features/imports/import-media-container.runtime.ts).

A version 2 derived manifest stores an explicit `no_audio_stream` marker. Persistence checks that the marker agrees with the validated source probe. Reading checks the manifest identity, byte count, checksum and private-object metadata. The speech pipeline also requires the acquisition evidence to agree. It then writes an absence receipt with no text, no provider/model, zero audio usage and zero cost, without invoking speech recognition. Missing or corrupted manifests/audio are never interpreted as absence. [Derived evidence](../../apps/api/src/features/imports/import-derived-media.ts), [speech pipeline](../../apps/api/src/features/imports/import-speech-transcription.ts).

A completed speech-provider response with no detected speech or unusable content has a distinct version 2 absence/failure receipt, retaining actual provider, model, usage and accounted cost. Unknown outcomes, timeouts and unavailable provider calls still stop; this change creates no retry authorization. Available transcripts remain strict and version 1 receipts remain readable. Caption and visual observations can populate recipe evidence after a verified absence or failure receipt; the receipt hash remains part of recovery identity. [Speech boundary](../../apps/api/src/features/imports/import-speech-transcriber.ts), [receipt store](../../apps/api/src/features/imports/transcript-evidence-store.ts), [draft assembly](../../apps/api/src/features/imports/import-recipe-draft.ts).

## Verification boundaries

A native FFmpeg 9.0.2 check generated a video-only MP4, remuxed it using the production optional audio map, verified one video stream and zero audio streams, and extracted three JPEG frames using the production arguments. The pinned Docker image uses FFmpeg 9.0.1; its integration expectation was updated, but that Docker suite was not run. This proves the local native command path for generated media, not deployed-container behavior.

Targeted tests cover all-frame submission, positional attribution, bounded total observations, full-byte manifests, old-manifest recovery, no-audio preparation, absence receipts, caption/visual draft continuation, and missing/corrupted source failures. The live model result above is separate from those deterministic tests. Container deployment, production recipe quality and a full real-video corpus run are not established by this change.
