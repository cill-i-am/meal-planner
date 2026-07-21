import * as Cloudflare from "alchemy/Cloudflare";

import { EvidenceRetentionSeconds } from "../features/imports/import-media.model.js";

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
