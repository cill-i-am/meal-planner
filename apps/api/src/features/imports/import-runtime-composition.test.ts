import { Cause, Effect, Exit, Option, Schema, Tracer } from "effect";
import { describe, expect, it } from "vitest";

import {
  ImportBatchDeliveryAttempt,
  ImportBatchId,
  ImportBatchItemId,
} from "./import-batch.contracts.js";
import { ImportCorrelationId } from "./import-observability.js";
import {
  consumeImportBatchDeadLetterDelivery,
  consumeImportBatchQueueDelivery,
  runImportVisualAndRecipeWorkflow,
} from "./import-runtime-composition.js";

const batchId = Schema.decodeUnknownSync(ImportBatchId)(
  "00000000-0000-4000-8000-000000000301"
);
const itemId = Schema.decodeUnknownSync(ImportBatchItemId)(
  "00000000-0000-4000-8000-000000000302"
);
const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "00000000-0000-4000-8000-000000000303"
);

describe("import runtime composition", () => {
  it("decodes, observes and delegates one queue delivery exactly once", async () => {
    const calls: string[] = [];
    const received: unknown[] = [];

    await Effect.runPromise(
      consumeImportBatchQueueDelivery(
        {
          attempts: 2,
          body: { batchId, itemId },
        },
        {
          acquire: () =>
            Effect.sync(() => {
              calls.push("acquire");
              return {
                consume: (message, deliveryAttempt, trace) =>
                  Effect.sync(() => {
                    calls.push("consume");
                    received.push({
                      deliveryAttempt,
                      message,
                      trace,
                    });
                  }),
                observeReceipt: () =>
                  Effect.sync(() => {
                    calls.push("observe");
                    return { correlationId };
                  }),
              };
            }),
        }
      )
    );

    expect(calls).toEqual(["acquire", "observe", "consume"]);
    expect(received).toEqual([
      {
        deliveryAttempt: Schema.decodeUnknownSync(ImportBatchDeliveryAttempt)(
          2
        ),
        message: { batchId, itemId },
        trace: { correlationId },
      },
    ]);
  });

  it("rejects malformed queue input before telemetry or runtime delegation", async () => {
    let downstreamCalls = 0;

    const exit = await Effect.runPromiseExit(
      consumeImportBatchQueueDelivery(
        {
          attempts: 0,
          body: {
            batchId,
            itemId,
            sourceUrl: "https://provider.invalid/private-source",
          },
        },
        {
          acquire: () =>
            Effect.sync(() => {
              downstreamCalls += 1;
              return {
                consume: () => Effect.void,
                observeReceipt: () => Effect.succeed({ correlationId }),
              };
            }),
        }
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("InvalidImportBatchQueueMessage");
      expect(exit.cause.toString()).not.toContain("provider.invalid");
      expect(exit.cause.toString()).not.toContain("private-source");
    }
    expect(downstreamCalls).toBe(0);
  });

  it("decodes and delegates one dead-letter delivery exactly once", async () => {
    const received: unknown[] = [];

    await Effect.runPromise(
      consumeImportBatchDeadLetterDelivery({ batchId, itemId }, (message) =>
        Effect.sync(() => {
          received.push(message);
        })
      )
    );

    expect(received).toEqual([{ batchId, itemId }]);
  });

  it("persists a visual terminal once and never dispatches recipe", async () => {
    const calls: string[] = [];
    const failure = {
      _tag: "Failed" as const,
      code: "provider_error",
      stage: "visual" as const,
    };

    const result = await Effect.runPromise(
      runImportVisualAndRecipeWorkflow({
        persistTerminal: (checkpoint) =>
          Effect.sync(() => calls.push(`persist:${checkpoint.stage}`)),
        recipe: Effect.sync(() => {
          calls.push("recipe");
          return { _tag: "Succeeded" as const, stage: "recipe" as const };
        }),
        visual: Effect.sync(() => {
          calls.push("visual");
          return failure;
        }),
      })
    );

    expect(result).toEqual(failure);
    expect(calls).toEqual(["visual", "persist:visual"]);
  });

  it("does not report public failure when private terminal persistence fails", async () => {
    const calls: string[] = [];
    const persistenceFailure = {
      _tag: "TestTerminalPersistenceFailure" as const,
    };
    const exit = await Effect.runPromiseExit(
      runImportVisualAndRecipeWorkflow({
        lifecycle: {
          beforeRecipe: Effect.void,
          beforeVisual: Effect.void,
          failurePersisted: () =>
            Effect.sync(() => {
              calls.push("public-failure");
            }),
          visualCompleted: Effect.void,
        },
        persistTerminal: () =>
          Effect.sync(() => {
            calls.push("persist");
          }).pipe(Effect.andThen(Effect.fail(persistenceFailure))),
        recipe: Effect.succeed({
          _tag: "Succeeded" as const,
          stage: "recipe" as const,
        }),
        visual: Effect.sync(() => {
          calls.push("visual");
          return {
            _tag: "Failed" as const,
            code: "provider_error",
            stage: "visual" as const,
          };
        }),
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBe(
        persistenceFailure
      );
    }
    expect(calls).toEqual(["visual", "persist"]);
  });

  it("runs visual then recipe exactly once on the success path", async () => {
    const calls: string[] = [];

    const result = await Effect.runPromise(
      runImportVisualAndRecipeWorkflow({
        persistTerminal: () =>
          Effect.sync(() => {
            calls.push("persist");
          }),
        recipe: Effect.sync(() => {
          calls.push("recipe");
          return { _tag: "Succeeded" as const, stage: "recipe" as const };
        }),
        visual: Effect.sync(() => {
          calls.push("visual");
          return { _tag: "Succeeded" as const, stage: "visual" as const };
        }),
      })
    );

    expect(result).toBeNull();
    expect(calls).toEqual(["visual", "recipe"]);
  });

  it("emits a named runtime span without queue identity attributes", async () => {
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });

    await Effect.runPromise(
      consumeImportBatchQueueDelivery(
        { attempts: 1, body: { batchId, itemId } },
        {
          acquire: () =>
            Effect.succeed({
              consume: () => Effect.void,
              observeReceipt: () => Effect.succeed({ correlationId }),
            }),
        }
      ).pipe(Effect.provideService(Tracer.Tracer, tracer))
    );

    expect(spans.map(({ name }) => name)).toContain(
      "ImportRuntime.consumeBatchQueueDelivery"
    );
    const serializedSpans = JSON.stringify(
      spans.map((span) => ({
        attributes: [...span.attributes],
        name: span.name,
      }))
    );
    expect(serializedSpans).not.toContain(batchId);
    expect(serializedSpans).not.toContain(itemId);
    expect(serializedSpans).not.toContain(correlationId);
  });
});
