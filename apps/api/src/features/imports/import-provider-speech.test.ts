import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeProviderTransports,
  makeRawProviderTransports,
  makeRejectedProviderTransports,
  correlationId,
  speechTranscriptionInput,
  nestUnknownMetadata,
  localDispatchGate,
  runFactory,
  makeRecordingTraceStore,
} from "./import-provider-adapters.test-fixture.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledSpeechTranscriber } from "./import-provider-speech.js";

describe("installed speech provider adapter", () => {
  it("uses the authenticated binding with provider logging disabled and the pinned combined speech response shape", async () => {
    const trace = makeRecordingTraceStore();
    const gateway = makeProviderTransports(
      {
        segments: [
          {
            avg_logprob: -0.25,
            compression_ratio: 1.1,
            end: 1,
            no_speech_prob: 0.01,
            start: 0,
            temperature: 0,
            text: "Chop the onion.",
            words: [
              {
                end: 0.5,
                start: 0,
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
        transcription_info: {
          duration: 1,
          duration_after_vad: 0.9,
          language: "en",
          language_probability: 0.99,
        },
        vtt: "WEBVTT",
        word_count: 3,
      },
      trace.service
    );
    const dispatches: {
      readonly actualCostMicroUsd: number;
      readonly maximumCostMicroUsd: number;
      readonly providerStageId: string;
    }[] = [];
    const dispatch: ProviderDispatchGate = {
      run: (input) =>
        input.invoke.pipe(
          Effect.tap(({ cost }) =>
            Effect.sync(() => {
              dispatches.push({
                actualCostMicroUsd:
                  cost._tag === "Known" ? cost.actualCostMicroUsd : -1,
                maximumCostMicroUsd: input.maximumCostMicroUsd,
                providerStageId: input.providerStageId,
              });
            })
          ),
          Effect.map(({ value }) => value)
        ),
    };
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch,
        transport: gateway.speech,
      }),
      trace.service
    );
    const transcript = await Effect.runPromise(
      adapter.transcribe({
        audio: {
          bytes: new Uint8Array([1, 2, 3]),
          durationMilliseconds: 60_000,
          mimeType: "audio/wav",
          sha256: "a".repeat(64),
        },
        dispatchId: "speech:import-1:1",
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(transcript.text).toBe("Chop the onion.");
    expect(transcript.cost).toEqual({
      certainty: "estimated",
      currency: "USD",
      estimatedMicroUsd: 510,
    });
    expect(dispatches).toEqual([
      {
        actualCostMicroUsd: 510,
        maximumCostMicroUsd: 50_000,
        providerStageId: "speech-transcription",
      },
    ]);
    expect(gateway.speechRequests[0]).toEqual({
      audio: "AQID",
      condition_on_previous_text: false,
      language: "en",
      task: "transcribe",
      vad_filter: true,
    });
    expect(JSON.stringify(gateway.speechRequests[0])).not.toMatch(
      /Chop the onion|https?:|cookie|credential|prompt|transcript/iu
    );
    expect(trace.events).toEqual([
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "speech",
      },
      {
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "speech",
      },
    ]);
    expect(JSON.stringify(trace.events)).not.toContain("Chop the onion.");
  });

  it("retains the pinned installed root speech response compatibility shape", async () => {
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports({
          text: "Chop the onion.",
          vtt: null,
          word_count: 3,
          words: [
            {
              end: 0.5,
              start: 0,
              word: "Chop",
            },
          ],
        }).speech,
      })
    );

    const transcript = await Effect.runPromise(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(transcript.text).toBe("Chop the onion.");
  });

  it("accepts bounded standard Whisper segment metadata and projects it away", async () => {
    const baselineAdapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports({
          segments: [],
          text: "Chop the onion.",
        }).speech,
      })
    );
    const trace = makeRecordingTraceStore();
    const metadataAdapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports({
          segments: [
            {
              id: 0,
              seek: 0,
              tokens: [50_365, 50_817],
            },
          ],
          text: "Chop the onion.",
        }).speech,
      }),
      trace.service
    );

    const [baselineTranscript, metadataTranscript] = await Promise.all([
      Effect.runPromise(baselineAdapter.transcribe(speechTranscriptionInput)),
      Effect.runPromise(metadataAdapter.transcribe(speechTranscriptionInput)),
    ]);

    expect(metadataTranscript).toEqual(baselineTranscript);
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      event: "provider.decode",
      outcome: "succeeded",
      providerStage: "speech",
    });
    expect(
      JSON.stringify({ metadataTranscript, trace: trace.events })
    ).not.toMatch(/50365|50817/u);
  });

  it("accepts only the bounded upper edge of standard Whisper segment metadata", async () => {
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports({
          segments: [
            {
              id: Number.MAX_SAFE_INTEGER,
              seek: Number.MAX_SAFE_INTEGER,
              tokens: Array.from({ length: 4096 }, () => 1),
            },
          ],
          text: "Chop the onion.",
        }).speech,
      })
    );

    const transcript = await Effect.runPromise(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(transcript.text).toBe("Chop the onion.");
  });

  it.each([
    ["one unconsumed root scalar", { platformRevision: 7 }],
    [
      "one inert root object",
      {
        platformMetadata: {
          attempt: 1,
          region: "synthetic",
        },
      },
    ],
    [
      "one deeply nested inert root object",
      {
        platformMetadata: nestUnknownMetadata("synthetic", 24),
      },
    ],
    [
      "multiple unconsumed root values",
      {
        platformEnabled: true,
        platformMetadata: {
          attempt: 1,
          region: "synthetic",
        },
        platformRevision: 7,
      },
    ],
  ] as const)(
    "discards %s after family discrimination without changing semantic output",
    async (_case, rootMetadata) => {
      const baselineAdapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports({
            segments: [],
            text: "Chop the onion.",
          }).speech,
        })
      );
      const trace = makeRecordingTraceStore();
      const metadataAdapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports({
            ...rootMetadata,
            segments: [],
            text: "Chop the onion.",
          }).speech,
        }),
        trace.service
      );

      const [baselineTranscript, metadataTranscript] = await Promise.all([
        Effect.runPromise(baselineAdapter.transcribe(speechTranscriptionInput)),
        Effect.runPromise(metadataAdapter.transcribe(speechTranscriptionInput)),
      ]);

      expect(metadataTranscript).toEqual(baselineTranscript);
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "speech",
      });
      expect(JSON.stringify(trace.events)).not.toMatch(
        /platform(?:Enabled|Metadata|Revision)|synthetic/u
      );
    }
  );

  it.each([
    [
      "transcription-info",
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: { duration: 1 },
      },
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: {
          duration: 1,
          providerPrivateInfoCanary: { revision: 7 },
        },
      },
      /providerPrivateInfoCanary|revision/u,
    ],
    [
      "segment",
      {
        segments: [{ id: 0 }],
        text: "Chop the onion.",
      },
      {
        segments: [
          {
            id: 0,
            providerPrivateSegmentCanary: { revision: 7 },
          },
        ],
        text: "Chop the onion.",
      },
      /providerPrivateSegmentCanary|revision/u,
    ],
    [
      "model-specific word",
      {
        segments: [{ words: [{ word: "Chop" }] }],
        text: "Chop the onion.",
      },
      {
        segments: [
          {
            words: [
              {
                providerPrivateWordCanary: { revision: 7 },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      /providerPrivateWordCanary|revision/u,
    ],
  ] as const)(
    "discards bounded inert %s metadata without changing semantic output",
    async (_case, baselineResponse, metadataResponse, privatePattern) => {
      const baselineAdapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports(baselineResponse).speech,
        })
      );
      const trace = makeRecordingTraceStore();
      const metadataAdapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports(metadataResponse).speech,
        }),
        trace.service
      );

      const [baselineTranscript, metadataTranscript] = await Promise.all([
        Effect.runPromise(baselineAdapter.transcribe(speechTranscriptionInput)),
        Effect.runPromise(metadataAdapter.transcribe(speechTranscriptionInput)),
      ]);

      expect(metadataTranscript).toEqual(baselineTranscript);
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "speech",
      });
      expect(JSON.stringify(trace.events)).not.toMatch(privatePattern);
    }
  );

  it("normalizes null only at allowlisted optional installed-runtime metadata positions", async () => {
    const compatibleResponses = [
      {
        segments: null,
        text: "Chop the onion.",
        transcription_info: null,
        vtt: null,
        word_count: null,
      },
      {
        segments: [
          {
            avg_logprob: null,
            compression_ratio: null,
            end: null,
            no_speech_prob: null,
            start: null,
            temperature: null,
            text: null,
            words: null,
          },
        ],
        text: "Chop the onion.",
        transcription_info: {
          duration: null,
          duration_after_vad: null,
          language: null,
          language_probability: null,
        },
        vtt: null,
        word_count: null,
      },
      {
        segments: [
          {
            words: [
              {
                end: null,
                start: null,
                word: null,
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
    ];

    await Promise.all(
      compatibleResponses.map(async (response) => {
        const adapter = await runFactory(
          makeInstalledSpeechTranscriber({
            correlationId,
            dispatch: localDispatchGate,
            transport: makeProviderTransports(response).speech,
          })
        );

        const transcript = await Effect.runPromise(
          adapter.transcribe(speechTranscriptionInput)
        );

        expect(transcript.text).toBe("Chop the onion.");
      })
    );
  });

  it("normalizes harmless whitespace from the pinned installed speech text contract", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports({
          segments: [],
          text: " \nChop the onion.\t ",
          transcription_info: {
            duration: 1,
            language: "en",
          },
          word_count: 3,
        }).speech,
      }),
      trace.service
    );

    const transcript = await Effect.runPromise(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(transcript.text).toBe("Chop the onion.");
    expect(transcript.segments).toEqual([
      {
        endMilliseconds: 1000,
        startMilliseconds: 0,
        text: "Chop the onion.",
      },
    ]);
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      event: "provider.decode",
      outcome: "succeeded",
      providerStage: "speech",
    });
  });

  it.each([
    ["non-object envelope", "invalid", "unclassified", "not_object", undefined],
    [
      "missing required text",
      { segments: [] },
      "model_specific",
      "required_text_missing",
      undefined,
    ],
    [
      "wrong required text type",
      { segments: [], text: 3 },
      "model_specific",
      "required_text_type",
      undefined,
    ],
    [
      "wrong root metadata type",
      { text: "Chop the onion.", word_count: "3" },
      "generic",
      "root_metadata_type",
      undefined,
    ],
    [
      "wrong nested container type",
      { segments: {}, text: "Chop the onion." },
      "model_specific",
      "nested_container_type",
      undefined,
    ],
    [
      "wrong nested entry type",
      { segments: [null], text: "Chop the onion." },
      "model_specific",
      "nested_entry_type",
      undefined,
    ],
    [
      "wrong nested metadata type",
      {
        text: "Chop the onion.",
        transcription_info: { duration: "1" },
      },
      "model_specific",
      "nested_metadata_type",
      undefined,
    ],
    [
      "wrong model segment id type",
      { segments: [{ id: "0" }], text: "Chop the onion." },
      "model_specific",
      "nested_metadata_type",
      undefined,
    ],
    [
      "wrong model segment seek type",
      { segments: [{ seek: "0" }], text: "Chop the onion." },
      "model_specific",
      "nested_metadata_type",
      undefined,
    ],
    [
      "wrong model segment tokens container",
      { segments: [{ tokens: {} }], text: "Chop the onion." },
      "model_specific",
      "nested_container_type",
      undefined,
    ],
    [
      "wrong model segment token type",
      { segments: [{ tokens: [1, "2"] }], text: "Chop the onion." },
      "model_specific",
      "nested_metadata_type",
      undefined,
    ],
    [
      "null model segment id",
      { segments: [{ id: null }], text: "Chop the onion." },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "out-of-range model segment id",
      {
        segments: [{ id: Number.MAX_SAFE_INTEGER + 1 }],
        text: "Chop the onion.",
      },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "non-finite model segment seek",
      {
        segments: [{ seek: Number.POSITIVE_INFINITY }],
        text: "Chop the onion.",
      },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "oversized model segment tokens",
      {
        segments: [{ tokens: Array.from({ length: 4097 }, () => 1) }],
        text: "Chop the onion.",
      },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "out-of-range model segment token",
      {
        segments: [{ tokens: [Number.MAX_SAFE_INTEGER + 1] }],
        text: "Chop the onion.",
      },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "standard segment metadata on a generic word",
      { text: "Chop the onion.", words: [{ id: 0 }] },
      "generic",
      "unsupported_property",
      "word",
    ],
    [
      "semantic constraint",
      { text: "Chop the onion.", word_count: -1 },
      "generic",
      "semantic_constraint",
      undefined,
    ],
    [
      "normalized text",
      { text: " \n\t " },
      "generic",
      "normalized_text_invalid",
      undefined,
    ],
    [
      "ambiguous mixed family",
      { segments: [], text: "Chop the onion.", words: [] },
      "unclassified",
      "unsupported_property",
      "root",
    ],
  ] as const)(
    "emits only bounded speech shape diagnostics for %s",
    async (
      testCase,
      response,
      speechEnvelopeFamily,
      speechEnvelopeFailure,
      speechEnvelopeUnsupportedLocation
    ) => {
      const speechEnvelopeUnsupportedRootProperty =
        testCase === "ambiguous mixed family" ? ("words" as const) : undefined;
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports(response).speech,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(JSON.stringify(exit)).toContain("SpeechTranscriptionFailure");
      expect(JSON.stringify(exit)).toContain("malformed_response");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason:
          speechEnvelopeFailure === "normalized_text_invalid"
            ? "speech_transcript_normalization_invalid"
            : "speech_envelope_schema_invalid",
        decodeStage:
          speechEnvelopeFailure === "normalized_text_invalid"
            ? "speech_transcript"
            : "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure,
        speechEnvelopeFamily,
        ...(speechEnvelopeUnsupportedLocation === undefined
          ? {}
          : { speechEnvelopeUnsupportedLocation }),
        ...(speechEnvelopeUnsupportedRootProperty === undefined
          ? {}
          : { speechEnvelopeUnsupportedRootProperty }),
      });
      expect(JSON.stringify(exit)).not.toContain("private-shape-canary");
      expect(JSON.stringify(trace.events)).not.toContain(
        "private-shape-canary"
      );
      expect(Object.keys(trace.events.at(-1) ?? {}).toSorted()).toEqual([
        "correlationId",
        "decodeReason",
        "decodeStage",
        "event",
        "outcome",
        "providerStage",
        "speechEnvelopeFailure",
        "speechEnvelopeFamily",
        ...(speechEnvelopeUnsupportedLocation === undefined
          ? []
          : ["speechEnvelopeUnsupportedLocation"]),
        ...(speechEnvelopeUnsupportedRootProperty === undefined
          ? []
          : ["speechEnvelopeUnsupportedRootProperty"]),
      ]);
    }
  );

  it.each([
    [
      "transcription info",
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: {
          duration: 1,
          privateInfoCanary: {
            nested: {
              text: "info-private-value",
            },
          },
        },
      },
      "model_specific",
      "transcription_info",
      undefined,
      "info-private-value",
    ],
    [
      "segment",
      {
        segments: [
          {
            id: 0,
            privateSegmentCanary: {
              text: "segment-private-value",
            },
          },
        ],
        text: "Chop the onion.",
      },
      "model_specific",
      "segment",
      undefined,
      "segment-private-value",
    ],
    [
      "model-specific word",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: {
                  nested: {
                    text: "word-private-value",
                  },
                },
                probability: 1,
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "model_specific",
      "word",
      undefined,
      "word-private-value",
    ],
    [
      "generic word",
      {
        text: "Chop the onion.",
        words: [
          {
            privateGenericWordCanary: "generic-word-private-value",
            word: "Chop",
          },
        ],
      },
      "generic",
      "word",
      undefined,
      "generic-word-private-value",
    ],
  ] as const)(
    "locates transcript-bearing unknown metadata at %s without exposing its name or value",
    async (
      _case,
      response,
      speechEnvelopeFamily,
      speechEnvelopeUnsupportedLocation,
      speechEnvelopeUnsupportedRootProperty,
      privateValue
    ) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports(response).speech,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "unsupported_property",
        speechEnvelopeFamily,
        speechEnvelopeUnsupportedLocation,
        ...(speechEnvelopeUnsupportedRootProperty === undefined
          ? {}
          : { speechEnvelopeUnsupportedRootProperty }),
      });
      expect(Object.keys(trace.events.at(-1) ?? {}).toSorted()).toEqual([
        "correlationId",
        "decodeReason",
        "decodeStage",
        "event",
        "outcome",
        "providerStage",
        "speechEnvelopeFailure",
        "speechEnvelopeFamily",
        "speechEnvelopeUnsupportedLocation",
        ...(speechEnvelopeUnsupportedRootProperty === undefined
          ? []
          : ["speechEnvelopeUnsupportedRootProperty"]),
      ]);
      expect(JSON.stringify(exit)).not.toContain(privateValue);
      expect(JSON.stringify(trace.events)).not.toContain(privateValue);
      expect(JSON.stringify(trace.events)).not.toMatch(
        /private(?:Root|Info|Segment|Word|GenericWord)Canary/u
      );
    }
  );

  it.each([
    [
      "discarded root metadata does not mask a nested failure",
      {
        privateRootCanary: "root-private-value",
        segments: [
          {
            privateSegmentCanary: {
              text: "segment-private-value",
            },
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
        transcription_info: {
          privateInfoCanary: {
            text: "info-private-value",
          },
        },
      },
      "transcription_info",
    ],
    [
      "transcription info before segment and word",
      {
        segments: [
          {
            privateSegmentCanary: {
              text: "segment-private-value",
            },
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
        transcription_info: {
          privateInfoCanary: {
            text: "info-private-value",
          },
        },
      },
      "transcription_info",
    ],
    [
      "segment before word",
      {
        segments: [
          {
            privateSegmentCanary: {
              text: "segment-private-value",
            },
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "segment",
    ],
    [
      "segment in a later item before word in an earlier item",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
          {
            privateSegmentCanary: {
              text: "segment-private-value",
            },
          },
        ],
        text: "Chop the onion.",
      },
      "segment",
    ],
    [
      "word when it is the only unsupported location",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "word",
    ],
  ] as const)(
    "uses deterministic unsupported-property precedence: %s",
    async (_case, response, speechEnvelopeUnsupportedLocation) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports(response).speech,
        }),
        trace.service
      );

      await Effect.runPromiseExit(adapter.transcribe(speechTranscriptionInput));

      expect(trace.events.at(-1)?.speechEnvelopeUnsupportedLocation).toBe(
        speechEnvelopeUnsupportedLocation
      );
      expect(JSON.stringify(trace.events)).not.toMatch(
        /private(?:Root|Info|Segment|Word)Canary|private-value/u
      );
    }
  );

  it.each([
    [
      "result wrapper",
      {
        result: {
          accepted: "wrapper-value-canary",
        },
        segments: [],
        text: "Chop the onion.",
      },
    ],
    [
      "success wrapper",
      {
        segments: [],
        success: true,
        text: "Chop the onion.",
      },
    ],
    [
      "errors wrapper",
      {
        errors: ["wrapper-value-canary"],
        segments: [],
        text: "Chop the onion.",
      },
    ],
    [
      "messages wrapper",
      {
        messages: ["wrapper-value-canary"],
        segments: [],
        text: "Chop the onion.",
      },
    ],
    [
      "unknown transcript-bearing object",
      {
        segments: [],
        syntheticTranscriptContainer: {
          text: "nested-transcript-canary",
        },
        text: "Chop the onion.",
      },
    ],
    [
      "deep unknown transcript-bearing object",
      {
        segments: [],
        syntheticTranscriptContainer: nestUnknownMetadata(
          {
            text: "nested-transcript-canary",
          },
          24
        ),
        text: "Chop the onion.",
      },
    ],
    [
      "unknown transcript-bearing array",
      {
        segments: [],
        syntheticTranscriptContainer: [
          {
            text: "nested-transcript-canary",
          },
        ],
        text: "Chop the onion.",
      },
    ],
    [
      "deep unknown transcript-bearing array/container",
      {
        segments: [],
        syntheticTranscriptContainer: [
          {
            nested: [
              {
                nested: {
                  text: "nested-transcript-canary",
                },
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
    ],
  ] as const)(
    "rejects an ambiguous %s without exposing its name or value",
    async (_case, response) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports(response).speech,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "unsupported_property",
        speechEnvelopeFamily: "model_specific",
        speechEnvelopeUnsupportedLocation: "root",
        speechEnvelopeUnsupportedRootProperty: "other",
      });
      expect(JSON.stringify(exit)).not.toMatch(
        /nested-transcript-canary|wrapper-value-canary/u
      );
      expect(JSON.stringify(trace.events)).not.toMatch(
        /nested-transcript-canary|syntheticTranscriptContainer|wrapper-value-canary/u
      );
    }
  );

  it.each([
    [
      "excessively deep inert unknown metadata",
      nestUnknownMetadata("inert-depth-canary", 70),
      "inert-depth-canary",
    ],
    [
      "excessively large inert unknown metadata",
      Array.from({ length: 20_000 }, () => "inert-size-canary"),
      "inert-size-canary",
    ],
  ] as const)(
    "fails closed for %s without exposing its name or value",
    async (_case, syntheticTraversalContainer, privateValue) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports({
            segments: [],
            syntheticTraversalContainer,
            text: "Chop the onion.",
          }).speech,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "unsupported_property",
        speechEnvelopeFamily: "model_specific",
        speechEnvelopeUnsupportedLocation: "root",
        speechEnvelopeUnsupportedRootProperty: "other",
      });
      expect(JSON.stringify(exit)).not.toContain(privateValue);
      expect(JSON.stringify(trace.events)).not.toMatch(
        /inert-(?:depth|size)-canary|syntheticTraversalContainer/u
      );
    }
  );

  it.each([
    [
      "transcription-info depth",
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: {
          privateInfoCanary: nestUnknownMetadata(
            "nested-depth-private-value",
            70
          ),
        },
      },
      "transcription_info",
      /nested-depth-private-value|privateInfoCanary/u,
    ],
    [
      "segment node count",
      {
        segments: [
          {
            privateSegmentCanary: Array.from(
              { length: 20_000 },
              () => "nested-size-private-value"
            ),
          },
        ],
        text: "Chop the onion.",
      },
      "segment",
      /nested-size-private-value|privateSegmentCanary/u,
    ],
    [
      "word depth",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: nestUnknownMetadata(
                  "nested-word-depth-private-value",
                  70
                ),
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "word",
      /nested-word-depth-private-value|privateWordCanary/u,
    ],
  ] as const)(
    "fails closed when unknown nested metadata exceeds the bounded %s traversal",
    async (
      _case,
      response,
      speechEnvelopeUnsupportedLocation,
      privatePattern
    ) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports(response).speech,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "unsupported_property",
        speechEnvelopeFamily: "model_specific",
        speechEnvelopeUnsupportedLocation,
      });
      expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
        privatePattern
      );
    }
  );

  it("shares the existing node budget across root and nested unknown metadata", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports({
          privateRootCanary: Array.from({ length: 6000 }, () => 1),
          segments: [
            {
              privateSegmentCanary: Array.from({ length: 6000 }, () => 3),
            },
          ],
          text: "Chop the onion.",
          transcription_info: {
            privateInfoCanary: Array.from({ length: 6000 }, () => 2),
          },
        }).speech,
      }),
      trace.service
    );

    const exit = await Effect.runPromiseExit(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(exit._tag).toBe("Failure");
    expect(trace.events.at(-1)).toMatchObject({
      speechEnvelopeFailure: "unsupported_property",
      speechEnvelopeUnsupportedLocation: "segment",
    });
    expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
      /private(?:Root|Info|Segment)Canary/u
    );
  });

  it.each(["transcription_info", "segment", "word"] as const)(
    "fails closed for cyclic unknown %s metadata",
    async (speechEnvelopeUnsupportedLocation) => {
      const cycle: Record<string, unknown> = {};
      cycle["nested"] = cycle;
      let response: unknown;
      if (speechEnvelopeUnsupportedLocation === "transcription_info") {
        response = {
          segments: [],
          text: "Chop the onion.",
          transcription_info: {
            privateCycleCanary: cycle,
          },
        };
      } else if (speechEnvelopeUnsupportedLocation === "segment") {
        response = {
          segments: [
            {
              privateCycleCanary: cycle,
            },
          ],
          text: "Chop the onion.",
        };
      } else {
        response = {
          segments: [
            {
              words: [
                {
                  privateCycleCanary: cycle,
                  word: "Chop",
                },
              ],
            },
          ],
          text: "Chop the onion.",
        };
      }
      const trace = makeRecordingTraceStore();
      const responseEnvelope = new Response(null, { status: 200 });
      Object.defineProperty(responseEnvelope, "json", {
        value: () => Promise.resolve(response),
      });
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeRawProviderTransports(responseEnvelope, trace.service)
            .speech,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "not_object",
        speechEnvelopeFamily: "unclassified",
      });
      expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
        /privateCycleCanary/u
      );
    }
  );

  it.each([
    [
      "transcription-info field",
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: {
          duration: -1,
          privateInfoCanary: "safe-private-value",
        },
      },
      "semantic_constraint",
    ],
    [
      "segment field",
      {
        segments: [
          {
            id: "0",
            privateSegmentCanary: "safe-private-value",
          },
        ],
        text: "Chop the onion.",
      },
      "nested_metadata_type",
    ],
    [
      "word field",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: "safe-private-value",
                start: "0",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "nested_metadata_type",
    ],
  ] as const)(
    "preserves strict validation of a malformed known %s beside inert unknown metadata",
    async (_case, response, speechEnvelopeFailure) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          correlationId,
          dispatch: localDispatchGate,
          transport: makeProviderTransports(response).speech,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toMatchObject({
        speechEnvelopeFailure,
        speechEnvelopeFamily: "model_specific",
      });
      expect(trace.events.at(-1)).not.toHaveProperty(
        "speechEnvelopeUnsupportedLocation"
      );
      expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
        /private(?:Info|Segment|Word)Canary|safe-private-value/u
      );
    }
  );

  it("omits the root-property classification for a nested unsupported property", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports({
          segments: [
            {
              id: 0,
              privateSegmentCanary: {
                text: "segment-private-value",
              },
              seek: 0,
              tokens: [50_365],
            },
          ],
          text: "Chop the onion.",
        }).speech,
      }),
      trace.service
    );

    const exit = await Effect.runPromiseExit(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(trace.events.at(-1)).toMatchObject({
      speechEnvelopeFailure: "unsupported_property",
      speechEnvelopeUnsupportedLocation: "segment",
    });
    expect(trace.events.at(-1)).not.toHaveProperty(
      "speechEnvelopeUnsupportedRootProperty"
    );
    expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
      /segment-private-value|50365/u
    );
  });

  it("omits unsupported-property location for a non-unsupported failure", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports({
          segments: [],
          text: 3,
        }).speech,
      }),
      trace.service
    );

    await Effect.runPromiseExit(adapter.transcribe(speechTranscriptionInput));

    expect(trace.events.at(-1)).toMatchObject({
      speechEnvelopeFailure: "required_text_type",
    });
    expect(trace.events.at(-1)).not.toHaveProperty(
      "speechEnvelopeUnsupportedLocation"
    );
  });

  it("fails closed for missing, wrong, ambiguous, or unsafe speech response fields", async () => {
    const malformedResponses = [
      {
        transcription_info: {
          duration: 1,
          language: "en",
        },
      },
      {
        text: 3,
        transcription_info: {
          duration: 1,
          language: "en",
        },
      },
      {
        segments: [],
        text: null,
      },
      {
        text: "Root transcript.",
        transcription_info: {
          text: "Nested transcript.",
        },
      },
      {
        text: "Same transcript.",
        transcription_info: {
          text: "Same transcript.",
        },
      },
      {
        result: {
          text: "Chop the onion.",
        },
      },
      {
        result: {
          text: "Nested transcript.",
        },
        text: "Root transcript.",
      },
      {
        segments: [],
        text: "Chop the onion.",
        words: [],
      },
      {
        text: "Chop the onion.",
        transcription_info: {
          language_probability: 1.01,
        },
      },
      {
        text: "Chop the onion.",
        transcription_info: {
          duration: -1,
        },
      },
      {
        text: "Chop the onion.",
        transcription_info: {
          language: " ",
        },
      },
      {
        segments: [
          {
            no_speech_prob: -0.01,
          },
        ],
        text: "Chop the onion.",
      },
      {
        segments: [null],
        text: "Chop the onion.",
      },
      {
        text: "a".repeat(1_048_577),
      },
    ];

    await Promise.all(
      malformedResponses.map(async (response) => {
        const trace = makeRecordingTraceStore();
        const adapter = await runFactory(
          makeInstalledSpeechTranscriber({
            correlationId,
            dispatch: localDispatchGate,
            transport: makeProviderTransports(response).speech,
          }),
          trace.service
        );

        const exit = await Effect.runPromiseExit(
          adapter.transcribe(speechTranscriptionInput)
        );

        expect(exit._tag).toBe("Failure");
        expect(JSON.stringify(exit)).toContain("malformed_response");
        expect(trace.events.at(-1)).toMatchObject({
          correlationId,
          decodeReason: "speech_envelope_schema_invalid",
          decodeStage: "speech_envelope",
          event: "provider.decode",
          outcome: "malformed",
          providerStage: "speech",
        });
        expect([
          "generic",
          "model_specific",
          "unclassified",
        ] as const).toContain(trace.events.at(-1)?.speechEnvelopeFamily);
        expect([
          "nested_container_type",
          "nested_entry_type",
          "nested_metadata_type",
          "required_text_missing",
          "required_text_type",
          "root_metadata_type",
          "semantic_constraint",
          "unsupported_property",
        ] as const).toContain(trace.events.at(-1)?.speechEnvelopeFailure);
        const diagnosticEvent = trace.events.at(-1);
        const hasUnsupportedLocation =
          diagnosticEvent?.speechEnvelopeFailure === "unsupported_property";
        expect(diagnosticEvent?.speechEnvelopeUnsupportedLocation).toSatisfy(
          (location) =>
            hasUnsupportedLocation
              ? ["root", "segment", "transcription_info", "word"].includes(
                  location ?? ""
                )
              : location === undefined
        );
        const hasUnsupportedRootProperty =
          diagnosticEvent?.speechEnvelopeUnsupportedRootProperty !== undefined;
        expect(
          diagnosticEvent?.speechEnvelopeUnsupportedRootProperty
        ).toSatisfy((property) =>
          hasUnsupportedRootProperty
            ? [
                "duration",
                "duration_after_vad",
                "language",
                "language_probability",
                "multiple",
                "other",
                "task",
                "words",
              ].includes(property ?? "")
            : property === undefined
        );
        expect(Object.keys(diagnosticEvent ?? {}).toSorted()).toEqual([
          "correlationId",
          "decodeReason",
          "decodeStage",
          "event",
          "outcome",
          "providerStage",
          "speechEnvelopeFailure",
          "speechEnvelopeFamily",
          ...(hasUnsupportedLocation
            ? ["speechEnvelopeUnsupportedLocation"]
            : []),
          ...(hasUnsupportedRootProperty
            ? ["speechEnvelopeUnsupportedRootProperty"]
            : []),
        ]);
        expect(JSON.stringify(exit)).not.toContain("must-not-escape");
        expect(JSON.stringify(trace.events)).not.toContain("must-not-escape");
      })
    );
  });

  it("fails closed with metadata-only transcript normalization diagnostics", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports({
          segments: [],
          text: " \n\t ",
          transcription_info: {
            duration: 1,
            language: "en",
          },
        }).speech,
      }),
      trace.service
    );

    const exit = await Effect.runPromiseExit(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      decodeReason: "speech_transcript_normalization_invalid",
      decodeStage: "speech_transcript",
      event: "provider.decode",
      outcome: "malformed",
      providerStage: "speech",
      speechEnvelopeFailure: "normalized_text_invalid",
      speechEnvelopeFamily: "model_specific",
    });
    expect(Object.keys(trace.events.at(-1) ?? {}).toSorted()).toEqual([
      "correlationId",
      "decodeReason",
      "decodeStage",
      "event",
      "outcome",
      "providerStage",
      "speechEnvelopeFailure",
      "speechEnvelopeFamily",
    ]);
  });

  it("settles known cost and fails closed when the installed speech response is malformed", async () => {
    const trace = makeRecordingTraceStore();
    const gateway = makeProviderTransports(
      {
        providerSecret: "must-not-escape",
        transcription_info: {
          duration: 1,
          language: "en",
        },
        word_count: 4,
      },
      trace.service
    );
    const settledCosts: number[] = [];
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: {
          run: (input) =>
            input.invoke.pipe(
              Effect.tap(({ cost }) =>
                Effect.sync(() => {
                  settledCosts.push(
                    cost._tag === "Known" ? cost.actualCostMicroUsd : -1
                  );
                })
              ),
              Effect.map(({ value }) => value)
            ),
        },
        transport: gateway.speech,
      }),
      trace.service
    );
    const exit = await Effect.runPromiseExit(
      adapter.transcribe({
        audio: {
          bytes: new Uint8Array([1]),
          durationMilliseconds: 1000,
          mimeType: "audio/wav",
          sha256: "a".repeat(64),
        },
        dispatchId: "speech:import-1:1",
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(settledCosts).toEqual([9]);
    expect(trace.events).toEqual([
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "speech",
      },
      {
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "required_text_missing",
        speechEnvelopeFamily: "model_specific",
      },
    ]);
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
    expect(JSON.stringify(trace.events)).not.toContain("must-not-escape");
  });

  it("preserves retryable native speech failures as typed redacted failures", async () => {
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeRejectedProviderTransports(
          Object.assign(new Error("providerSecret=must-not-escape"), {
            _tag: "AiGatewayError",
            cause: {
              providerSecret: "must-not-escape",
              status: 429,
            },
          })
        ).speech,
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.transcribe({
        audio: {
          bytes: new Uint8Array([1]),
          durationMilliseconds: 1000,
          mimeType: "audio/wav",
          sha256: "a".repeat(64),
        },
        dispatchId: "speech:import-1:1",
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("throttled");
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
  });
});
