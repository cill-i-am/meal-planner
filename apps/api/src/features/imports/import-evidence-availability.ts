import { Effect } from "effect";

import type { HouseholdReadEvidenceReferencesResult } from "../households/evidence/household-evidence.contract.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";

type EvidenceReference =
  (typeof HouseholdReadEvidenceReferencesResult.Type)["references"][number];

export interface InspectedEvidenceReference {
  readonly availability: "available" | "missing";
  readonly reference: EvidenceReference;
}

/** Performs R2 I/O before any household authority transaction is entered. */
export const inspectHouseholdEvidenceReferences = Effect.fn(
  "ImportEvidence.inspectHouseholdReferences"
)(function* inspectHouseholdEvidenceReferencesEffect(
  bucket: Pick<AcquisitionBucketLike, "head">,
  references: readonly EvidenceReference[]
) {
  return yield* Effect.forEach(
    references,
    (reference) =>
      bucket.head(reference.key).pipe(
        Effect.map(
          (object): InspectedEvidenceReference => ({
            availability: object === null ? "missing" : "available",
            reference,
          })
        )
      ),
    { concurrency: 2 }
  );
});
