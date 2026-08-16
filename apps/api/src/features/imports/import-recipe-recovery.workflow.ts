import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";

import { makeImportRecipeRecoveryWorkflowHandler } from "./import-runtime-composition.js";

/** A recipe-only host with no acquisition, source, speech, or visual adapter. */
export default class ImportRecipeRecoveryWorkflow extends Cloudflare.Workflow<ImportRecipeRecoveryWorkflow>()(
  "ImportRecipeRecoveryWorkflow",
  makeImportRecipeRecoveryWorkflowHandler({
    task: Cloudflare.Workflows.task,
    waitForEvent: Cloudflare.Workflows.waitForEvent,
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.AI.QueryGatewayBinding,
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding
      )
    )
  )
) {}
