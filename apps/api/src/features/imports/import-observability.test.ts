import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  ImportCorrelationId,
  ImportObservabilityEvent,
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
  makeImportCorrelationId,
  metadataOnlyGatewayHeaders,
} from "./import-observability.js";

const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
);

describe("private import observability", () => {
  it("creates opaque, distinct correlation identifiers", () => {
    const first = makeImportCorrelationId();
    const second = makeImportCorrelationId();

    expect(first).not.toBe(second);
    expect(Schema.is(ImportCorrelationId)(first)).toBe(true);
    expect(Schema.is(ImportCorrelationId)(second)).toBe(true);
  });

  it("sets metadata-only AI Gateway headers with no payload-bearing values", () => {
    expect(metadataOnlyGatewayHeaders(correlationId)).toEqual({
      "cf-aig-collect-log": "true",
      "cf-aig-collect-log-payload": "false",
      "cf-aig-metadata": JSON.stringify({ correlationId }),
      "content-type": "application/json",
    });
  });

  it.each([
    "authorization",
    "cookie",
    "credential",
    "headers",
    "media",
    "objectKey",
    "prompt",
    "providerPayload",
    "rawError",
    "rawStderr",
    "rawStdout",
    "sourceId",
    "sourceHeaders",
    "sourceUrl",
    "stderr",
    "stdout",
    "transcript",
    "url",
  ])("rejects the sensitive %s field at the logging boundary", (field) => {
    const decode = Schema.decodeUnknownSync(ImportObservabilityEvent, {
      onExcessProperty: "error",
    });

    expect(() =>
      decode({
        correlationId,
        event: "provider.response",
        providerStage: "speech",
        [field]: "sensitive",
      })
    ).toThrow();
  });

  it("drops invalid telemetry without synchronously surfacing forbidden values", async () => {
    const forbiddenValue = "https://secret.example/video?token=private-canary";
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    let telemetry: Effect.Effect<void> | undefined;

    expect(() => {
      telemetry = emitImportObservabilityEvent({
        correlationId,
        event: "acquisition.response",
        sourceUrl: forbiddenValue,
      });
    }).not.toThrow();
    await expect(
      Effect.runPromise(telemetry ?? Effect.die("missing telemetry effect"))
    ).resolves.toBeUndefined();

    expect(JSON.stringify(log.mock.calls)).not.toContain(forbiddenValue);
    log.mockRestore();
  });

  it("emits only the closed event name and allowlisted annotations", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());

    await Effect.runPromise(
      emitImportObservabilityEvent({
        attempt: 2,
        correlationId,
        event: "provider.retry",
        outcome: "retrying",
        providerStage: "speech",
      })
    );

    expect(log).toHaveBeenCalledExactlyOnceWith({
      attempt: 2,
      correlationId,
      event: "provider.retry",
      outcome: "retrying",
      providerStage: "speech",
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );
    log.mockRestore();
  });

  it("emits only closed decode-stage and reason classifications", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());

    await Effect.runPromise(
      emitImportObservabilityEvent({
        correlationId,
        decodeReason: "forced_tool_envelope_invalid",
        decodeStage: "forced_tool_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "recipe",
      })
    );

    expect(log).toHaveBeenCalledExactlyOnceWith({
      correlationId,
      decodeReason: "forced_tool_envelope_invalid",
      decodeStage: "forced_tool_envelope",
      event: "provider.decode",
      outcome: "malformed",
      providerStage: "recipe",
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );
    log.mockRestore();
  });

  it.each([
    ["decodeStage", "unbounded-stage"],
    ["decodeReason", "raw-provider-response"],
  ])("rejects an open %s value", (field, value) => {
    const decode = Schema.decodeUnknownSync(ImportObservabilityEvent, {
      onExcessProperty: "error",
    });

    expect(() =>
      decode({
        correlationId,
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "recipe",
        [field]: value,
      })
    ).toThrow();
  });

  it.each([
    ["budget.reservation", "reserved"],
    ["provider.dispatch", "started"],
    ["provider.response", "received"],
    ["provider.settlement", "known"],
  ] as const)(
    "keeps a failed private trace write outside the %s lifecycle seam",
    async (event, outcome) => {
      const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
      const traceStore = ImportObservabilityTraceStore.of({
        append: () => Effect.die(new Error("trace persistence unavailable")),
        read: () => Effect.succeed([]),
      });

      await expect(
        Effect.runPromise(
          emitImportObservabilityEvent(
            {
              correlationId,
              event,
              outcome,
              providerStage: "speech",
            },
            traceStore
          )
        )
      ).resolves.toBeUndefined();

      expect(log).toHaveBeenCalledExactlyOnceWith({
        correlationId,
        event,
        outcome,
        providerStage: "speech",
      });
      log.mockRestore();
    }
  );

  it("preserves caller interruption while isolating trace failures", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const traceStore = ImportObservabilityTraceStore.of({
      append: () => Effect.interrupt,
      read: () => Effect.succeed([]),
    });

    const exit = await Effect.runPromiseExit(
      emitImportObservabilityEvent(
        {
          correlationId,
          event: "provider.dispatch",
          outcome: "started",
          providerStage: "speech",
        },
        traceStore
      )
    );

    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    log.mockRestore();
  });
});
