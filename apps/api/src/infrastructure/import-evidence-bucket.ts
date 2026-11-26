import * as Cloudflare from "@alchemy.run/cloudflare";
import { EvidenceRetentionSeconds } from "@meal-planner/recipe-imports/media/model";

/** Private, short-lived acquisition evidence; no domain, CORS, or public route. */
export const ImportEvidenceBucket = Cloudflare.R2.Bucket(
  "ImportEvidenceBucket",
  {
    cors: [],
    domains: [],
    lifecycleRules: [
      {
        deleteObjectsTransition: {
          condition: { maxAge: EvidenceRetentionSeconds, type: "Age" },
        },
        id: "delete-import-evidence-after-seven-days",
        prefix: "imports/",
      },
    ],
  }
);
