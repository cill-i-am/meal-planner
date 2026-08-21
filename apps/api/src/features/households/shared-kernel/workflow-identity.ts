import { Effect, Schema } from "effect";

import type { ImportIntentExecutionGeneration } from "../../imports/import-intent-transition.js";
import type { ImportId } from "../../imports/import.contracts.js";
import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
} from "./authority-services.js";

export const ImportWorkflowIdentity = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^import-acquisition:v1:[a-f\d]{64}$/u)),
  Schema.brand("ImportWorkflowIdentity")
);
export type ImportWorkflowIdentity = typeof ImportWorkflowIdentity.Type;

export const makeImportWorkflowIdentity = (input: {
  readonly executionGeneration: ImportIntentExecutionGeneration;
  readonly importId: ImportId;
}) =>
  Effect.gen(function* deriveImportWorkflowIdentity() {
    const canonical = yield* HouseholdCanonicalEncoding;
    const digest = yield* HouseholdDigest;
    const encoded = yield* canonical.encode({
      executionGeneration: input.executionGeneration,
      importId: input.importId,
      purpose: "import-acquisition",
      version: 1,
    });
    return yield* Schema.decodeUnknownEffect(ImportWorkflowIdentity)(
      `import-acquisition:v1:${yield* digest.sha256(encoded)}`
    );
  });
