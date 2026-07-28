import { Data, Effect, Schema } from "effect";

import { ImportCorrelationId } from "./import-observability.js";
import { ImportId } from "./import.contracts.js";

export const ImportWorkflowInput = Schema.Struct({
  correlationId: ImportCorrelationId,
  importId: ImportId,
});

export const LegacyImportWorkflowInput = Schema.Struct({
  importId: ImportId,
});

const AcceptedImportWorkflowInput = Schema.Union([
  ImportWorkflowInput,
  LegacyImportWorkflowInput,
]);

export class InvalidImportWorkflowInput extends Data.TaggedError(
  "InvalidImportWorkflowInput"
) {}

export const decodeImportWorkflowInput = (rawInput: unknown) =>
  Schema.decodeUnknownEffect(AcceptedImportWorkflowInput, {
    onExcessProperty: "error",
  })(rawInput).pipe(Effect.mapError(() => new InvalidImportWorkflowInput()));

const LegacyCorrelationNamespace = new Uint8Array([
  0xd7, 0x34, 0x29, 0x98, 0xb4, 0xf0, 0x5d, 0xf2, 0x8f, 0x6f, 0x8c, 0x6b, 0x31,
  0x95, 0xd9, 0x8a,
]);

const formatUuid = (bytes: Uint8Array) => {
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

/**
 * Derive a replay-stable UUIDv5 from the already opaque import identity.
 *
 * Legacy workflow histories have no correlation checkpoint. A fresh random
 * UUID would therefore change when Cloudflare reconstructs the workflow during
 * a restart. The namespaced derivation needs no new historical step, contains
 * no source or provider data, and remains stable across reconstruction.
 */
export const makeLegacyImportCorrelationId = (importId: ImportId) =>
  Effect.promise(async () => {
    const name = new TextEncoder().encode(
      `meal-planner/import-workflow/${importId}`
    );
    const namespacedName = new Uint8Array(
      LegacyCorrelationNamespace.length + name.length
    );
    namespacedName.set(LegacyCorrelationNamespace);
    namespacedName.set(name, LegacyCorrelationNamespace.length);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-1", namespacedName)
    );
    const uuid = digest.slice(0, 16);
    uuid[6] = ((uuid[6] ?? 0) % 16) + 80;
    uuid[8] = ((uuid[8] ?? 0) % 64) + 128;
    return Schema.decodeUnknownSync(ImportCorrelationId)(formatUuid(uuid));
  });

export const resolveImportWorkflowInput = (rawInput: unknown) =>
  Effect.gen(function* resolveInput() {
    const input = yield* decodeImportWorkflowInput(rawInput);
    if ("correlationId" in input) {
      return input;
    }
    const correlationId = yield* makeLegacyImportCorrelationId(input.importId);
    return { correlationId, importId: input.importId };
  });
