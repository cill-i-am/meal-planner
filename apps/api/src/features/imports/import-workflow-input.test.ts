import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeImportWorkflowInput,
  makeLegacyImportCorrelationId,
  resolveImportWorkflowInput,
} from "./import-workflow-input.js";
import { ImportId } from "./import.contracts.js";

const importId = "00000000-0000-4000-8000-000000000188";
const correlationId = "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2188";

describe("import workflow input", () => {
  it("preserves the exact current correlation input", async () => {
    await expect(
      Effect.runPromise(resolveImportWorkflowInput({ correlationId, importId }))
    ).resolves.toEqual({ correlationId, importId });
  });

  it("derives a stable domain-separated opaque UUID for legacy input", async () => {
    const decodedImportId = Schema.decodeUnknownSync(ImportId)(importId);
    const otherImportId = Schema.decodeUnknownSync(ImportId)(
      "00000000-0000-4000-8000-000000000189"
    );
    const [first, replayed, other] = await Effect.runPromise(
      Effect.all([
        makeLegacyImportCorrelationId(decodedImportId),
        makeLegacyImportCorrelationId(decodedImportId),
        makeLegacyImportCorrelationId(otherImportId),
      ])
    );

    expect(first).toBe(replayed);
    expect(first).not.toBe(importId);
    expect(first).not.toBe(other);
    expect(first.at(14)).toBe("5");
  });

  it.each([
    {},
    { importId, sourceUrl: "sensitive-source-sentinel" },
    { correlationId, importId, transcript: "sensitive-text-sentinel" },
    { correlationId: "not-a-uuid", importId },
    { importId: "not-a-uuid" },
  ])("rejects invalid or excess input %#", async (input) => {
    const exit = await Effect.runPromiseExit(decodeImportWorkflowInput(input));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).not.toContain("sensitive");
  });
});
