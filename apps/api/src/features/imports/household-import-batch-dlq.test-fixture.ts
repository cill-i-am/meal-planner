import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";

import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { handleHouseholdImportBatchDeadLetterMessage } from "./household-import-batch-queue.handlers.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface TestMessageBatch {
  readonly messages: readonly { readonly body: unknown }[];
}

interface TestServiceBinding {
  readonly fetch: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Promise<Response>;
}

interface Environment {
  readonly DLQ_RESULTS: TestKvNamespace;
  readonly HouseholdDomainWorker: object;
  readonly QueueConsumer: TestServiceBinding;
}

const Reconciliation = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Active") }),
  Schema.Struct({ _tag: Schema.Literal("Complete") }),
  Schema.Struct({ _tag: Schema.Literal("NotStarted") }),
  Schema.Struct({ _tag: Schema.Literal("Redriven") }),
]);

const workflowLauncher = (environment: Environment) => ({
  create: () => Effect.die(new Error("DLQ reconciliation cannot create")),
  reconcile: (workflowId: string) =>
    Effect.promise(() =>
      environment.QueueConsumer.fetch(
        `http://queue-consumer/reconcile?workflowId=${encodeURIComponent(workflowId)}`
      )
    ).pipe(
      Effect.filterOrFail(
        (response) => response.ok,
        () => new Error("workflow reconciliation unavailable")
      ),
      Effect.flatMap((response) => Effect.promise(() => response.json())),
      Effect.flatMap(Schema.decodeUnknownEffect(Reconciliation))
    ),
});

export default {
  async queue(batch: TestMessageBatch, environment: Environment) {
    const household = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
      environment.HouseholdDomainWorker
    );
    await Promise.all(
      batch.messages.map(async ({ body }) => {
        const attempts = Number(
          (await environment.DLQ_RESULTS.get("attempts")) ?? "0"
        );
        await environment.DLQ_RESULTS.put("attempts", String(attempts + 1));
        const settled = await Effect.runPromise(
          handleHouseholdImportBatchDeadLetterMessage(
            body,
            household,
            workflowLauncher(environment)
          )
        );
        await environment.DLQ_RESULTS.put("last", JSON.stringify(settled));
      })
    );
  },
};
