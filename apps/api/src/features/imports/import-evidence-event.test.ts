import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decodeSafeImportEvidenceEvent } from "./import-evidence-event.js";

const importId = "018f7f67-e0c7-7d34-a593-8c20c6f7b868";
const event = (key: string, action = "PutObject") => ({
  account: "redacted-account",
  action,
  bucket: "redacted-bucket",
  eventTime: "2026-08-22T12:00:00.000Z",
  object: { eTag: "redacted", key, size: 42 },
});

describe("import evidence R2 notifications", () => {
  it("decodes a closed event into the minimum private routing identity", async () => {
    const decoded = await Effect.runPromise(
      decodeSafeImportEvidenceEvent(
        event(
          `imports/${importId}/transcription/v1/generations/3/transcript.json`,
          "LifecycleDeletion"
        )
      )
    );

    expect(decoded).toEqual({
      acquisitionGeneration: 3,
      action: "LifecycleDeletion",
      artifact: "speech_transcript",
      eventTime: "2026-08-22T12:00:00.000Z",
      importId,
      objectKey: `imports/${importId}/transcription/v1/generations/3/transcript.json`,
      referenceKind: "speech_transcript",
    });
    expect(JSON.stringify(decoded)).not.toContain("redacted-account");
    expect(JSON.stringify(decoded)).not.toContain("redacted-bucket");
  });

  it("rejects unknown keys, excess fields, generation zero, and unknown actions", async () => {
    const invalid = [
      event(`imports/${importId}/unknown/v1/generations/3/object.bin`),
      event(`imports/${importId}/acquisition/v1/generations/0/original.mp4`),
      event(
        `imports/${importId}/acquisition/v1/generations/3/original.mp4`,
        "UnknownAction"
      ),
      {
        ...event(
          `imports/${importId}/acquisition/v1/generations/3/original.mp4`
        ),
        organizationId: "must-not-be-routable",
      },
    ];

    await Promise.all(
      invalid.map((candidate) =>
        expect(
          Effect.runPromise(decodeSafeImportEvidenceEvent(candidate))
        ).rejects.toBeDefined()
      )
    );
  });
});
