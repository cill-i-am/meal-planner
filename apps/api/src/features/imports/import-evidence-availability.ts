import type { AcquisitionBucketLike } from "@meal-planner/recipe-imports/media/acquirer";
import { Effect } from "effect";

import type { HouseholdReadEvidenceReferencesResult } from "../households/evidence/household-evidence.contract.js";

type EvidenceReference = NonNullable<
  typeof HouseholdReadEvidenceReferencesResult.Type
>["references"][number];

interface InspectedEvidenceReference {
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
        Effect.map((object) => {
          const checkedResult: InspectedEvidenceReference = {
            availability: object === null ? "missing" : "available",
            reference,
          };
          return checkedResult;
        })
      ),
    { concurrency: 2 }
  );
});
