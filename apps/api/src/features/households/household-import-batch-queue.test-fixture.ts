import { Effect } from "effect";

import { decodeHouseholdBatchQueueMessage } from "../imports/household-import-batch-transport.js";

interface TestMessageBatch {
  readonly messages: readonly {
    readonly ack: () => void;
    readonly body: unknown;
  }[];
}

interface Environment {
  readonly BATCH_QUEUE_RESULTS: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
}

export default {
  async queue(batch: TestMessageBatch, environment: Environment) {
    await Promise.all(
      batch.messages.map(async (transportMessage) => {
        const message = await Effect.runPromise(
          decodeHouseholdBatchQueueMessage(transportMessage.body)
        );
        const deliveries = Number(
          (await environment.BATCH_QUEUE_RESULTS.get(
            `${message.itemId}:deliveries`
          )) ?? "0"
        );
        await environment.BATCH_QUEUE_RESULTS.put(
          message.itemId,
          JSON.stringify(message)
        );
        await environment.BATCH_QUEUE_RESULTS.put(
          `${message.itemId}:deliveries`,
          String(deliveries + 1)
        );
        transportMessage.ack();
      })
    );
  },
};
