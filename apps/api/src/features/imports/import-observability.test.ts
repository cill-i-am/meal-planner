import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  ImportCorrelationId,
  ImportObservabilityEvent,
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
    "media",
    "objectKey",
    "prompt",
    "providerPayload",
    "rawError",
    "sourceId",
    "sourceUrl",
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
});
