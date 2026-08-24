import { Effect } from "effect";

import { decodeHouseholdBatchQueueMessage } from "./household-import-batch-transport.js";

interface TestKvNamespace {
  readonly put: (key: string, value: string) => Promise<void>;
}

interface TestMessageBatch {
  readonly messages: readonly {
    readonly ack: () => void;
    readonly body: unknown;
  }[];
}

interface Environment {
  readonly DLQ_RESULTS: TestKvNamespace;
}

export default {
  async queue(batch: TestMessageBatch, environment: Environment) {
    await Promise.all(
      batch.messages.map(async (message) => {
        const decoded = await Effect.runPromise(
          decodeHouseholdBatchQueueMessage(message.body)
        );
        await environment.DLQ_RESULTS.put("last", JSON.stringify(decoded));
        message.ack();
      })
    );
  },
};
