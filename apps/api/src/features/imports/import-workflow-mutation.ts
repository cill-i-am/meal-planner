import { Effect, Schema } from "effect";

import { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import { sha256Bytes } from "./import-digest.js";

export const workflowMutationId = (semanticKey: string) =>
  sha256Bytes(
    new TextEncoder().encode(
      `household-recipe-import-workflow:v1:${semanticKey}`
    )
  ).pipe(Effect.map(Schema.decodeUnknownSync(HouseholdImportMutationId)));
