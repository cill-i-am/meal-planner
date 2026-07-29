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

  it("preserves only the typed private prepared-visual recovery input", async () => {
    await expect(
      Effect.runPromise(
        resolveImportWorkflowInput({
          correlationId,
          importId,
          resume: "prepared_visual_recovery",
        })
      )
    ).resolves.toEqual({
      correlationId,
      importId,
      resume: "prepared_visual_recovery",
    });
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

  it("resolves legacy input without a runtime SHA-1 WebCrypto seam", async () => {
    const sha1UnavailableCrypto = new Proxy(globalThis.crypto, {
      get: (target, property, receiver) => {
        if (property === "subtle") {
          return {
            digest: () =>
              Promise.reject(new Error("SHA-1 is unavailable in this runtime")),
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "crypto"
    );
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: sha1UnavailableCrypto,
    });

    try {
      await expect(
        Effect.runPromise(resolveImportWorkflowInput({ importId }))
      ).resolves.toEqual({
        correlationId: "b44d09c6-67ca-527c-a2c7-86628ffc08a6",
        importId,
      });
    } finally {
      if (cryptoDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      }
    }
  });

  it.each([
    {},
    { importId, sourceUrl: "sensitive-source-sentinel" },
    { correlationId, importId, transcript: "sensitive-text-sentinel" },
    { correlationId, importId, resume: "unknown_recovery" },
    { correlationId: "not-a-uuid", importId },
    { importId: "not-a-uuid" },
  ])("rejects invalid or excess input %#", async (input) => {
    const exit = await Effect.runPromiseExit(decodeImportWorkflowInput(input));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).not.toContain("sensitive");
  });
});
