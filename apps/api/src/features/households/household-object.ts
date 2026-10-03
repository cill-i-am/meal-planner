import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { HouseholdOutputFenceLive } from "../private-output/household-output-fence.js";
import { HouseholdImportBatchQueueWriterLive } from "./batches/household-import-batch-queue.live.js";
import { makeHouseholdObjectRuntime } from "./household-object-runtime.js";
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

/** Stable Alchemy class host. Drizzle generates SQL; Alchemy applies captured migrations. */
export default class HouseholdObject extends Cloudflare.DurableObject<HouseholdObject>()(
  "HouseholdObject",
  Effect.gen(function* constructHouseholdObject() {
    const migrations = yield* Cloudflare.SqlMigrations({
      dir: "./apps/api/household-migrations",
      table: "__drizzle_migrations",
    });
    return yield* makeHouseholdObjectRuntime(migrations);
  }).pipe(
    Effect.provide(HouseholdAuthorityServicesLive),
    Effect.provide(HouseholdOutputFenceLive),
    Effect.provide(HouseholdImportBatchQueueWriterLive),
    Effect.provide(Cloudflare.Queues.WriteQueueBinding)
  )
) {}
