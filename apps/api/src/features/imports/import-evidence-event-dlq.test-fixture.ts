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
        await environment.DLQ_RESULTS.put("last", JSON.stringify(message.body));
        message.ack();
      })
    );
  },
};
