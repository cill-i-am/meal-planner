import * as Cloudflare from "alchemy/Cloudflare";

/** Transport for immutable household/batch/item/generation envelopes only. */
export const HouseholdImportBatchQueue = Cloudflare.Queues.Queue(
  "HouseholdImportBatchQueue"
);

/** Exhausted deliveries remain inspectable while household SQLite is canonical. */
export const HouseholdImportBatchDeadLetterQueue = Cloudflare.Queues.Queue(
  "HouseholdImportBatchDeadLetterQueue"
);
