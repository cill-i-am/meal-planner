import { Effect } from "effect";

import {
  decodeHouseholdBatchQueueMessage,
  householdBatchWorkflowInstanceId,
} from "./household-import-batch-transport.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface TestMessageBatch {
  readonly messages: readonly {
    readonly ack: () => void;
    readonly body: unknown;
    readonly retry: () => void;
  }[];
}

interface Environment {
  readonly RESULTS: TestKvNamespace;
}

export default {
  async queue(batch: TestMessageBatch, environment: Environment) {
    await Promise.all(
      batch.messages.map(async (message) => {
        const attempts = Number(
          (await environment.RESULTS.get("attempts")) ?? "0"
        );
        await environment.RESULTS.put("attempts", String(attempts + 1));
        const decoded = await Effect.runPromise(
          decodeHouseholdBatchQueueMessage(message.body)
        );
        await environment.RESULTS.put(
          "last",
          JSON.stringify({
            message: decoded,
            workflowId: householdBatchWorkflowInstanceId(decoded),
          })
        );
        if (decoded.itemId.endsWith("9999")) {
          message.retry();
        } else {
          message.ack();
        }
      })
    );
  },
};
