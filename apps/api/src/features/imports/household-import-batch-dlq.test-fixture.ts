import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { handleHouseholdImportBatchDeadLetterMessage } from "./household-import-batch-queue.handlers.js";

interface TestKvNamespace {
  readonly put: (key: string, value: string) => Promise<void>;
}

interface TestMessageBatch {
  readonly messages: readonly { readonly body: unknown }[];
}

interface Environment {
  readonly DLQ_RESULTS: TestKvNamespace;
  readonly HouseholdDomainWorker: object;
}

export default {
  async queue(batch: TestMessageBatch, environment: Environment) {
    const household = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
      environment.HouseholdDomainWorker
    );
    await Promise.all(
      batch.messages.map(async ({ body }) => {
        const settled = await Effect.runPromise(
          handleHouseholdImportBatchDeadLetterMessage(body, household)
        );
        await environment.DLQ_RESULTS.put("last", JSON.stringify(settled));
      })
    );
  },
};
