import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { HouseholdImportBatchQueueWriterLive } from "./batches/household-import-batch-queue.live.js";
import { HouseholdObjectRuntime } from "./household-object-runtime.js";
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

/** Stable Alchemy class host. SQLite evolution belongs to Drizzle migrations. */
export default class HouseholdObject extends Cloudflare.DurableObject<HouseholdObject>()(
  "HouseholdObject",
  HouseholdObjectRuntime.pipe(
    Effect.provide(HouseholdAuthorityServicesLive),
    Effect.provide(HouseholdImportBatchQueueWriterLive),
    Effect.provide(Cloudflare.Queues.WriteQueueBinding)
  )
) {}
