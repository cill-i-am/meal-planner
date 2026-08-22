import { Effect } from "effect";

import { decodeSafeImportEvidenceEvent } from "./import-evidence-event.js";

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
  readonly RESULTS: TestKvNamespace;
}

export default {
  async queue(batch: TestMessageBatch, environment: Environment) {
    for (const message of batch.messages) {
      const projection = await Effect.runPromise(
        decodeSafeImportEvidenceEvent(message.body).pipe(
          Effect.map((value) => ({ _tag: "Accepted" as const, value })),
          Effect.catch(() => Effect.succeed({ _tag: "Rejected" as const }))
        )
      );
      await environment.RESULTS.put("last", JSON.stringify(projection));
      message.ack();
    }
  },
};
