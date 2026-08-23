import { RuntimeContext } from "alchemy";
import { Effect, Schema, Tracer } from "effect";
import { describe, expect, it, vi } from "vitest";

import { HouseholdOrganizationId } from "../households/household.contract.js";
import { ImportWorkflowIdentity } from "../households/shared-kernel/workflow-identity.js";
import {
  ProviderAccountingRunId,
  ProviderAccountingTimestamp,
} from "../provider-accounting/provider-accounting.js";
import type { ProviderAccountingRepository } from "../provider-accounting/provider-accounting.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import type { ImportObservabilityEvent } from "./import-observability.js";
import {
  ImportCorrelationId,
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
  observeImportQueueReceipt,
  observeImportWorkflowStart,
} from "./import-observability.js";
import { makeVisualTransport } from "./import-provider-adapters.test-fixture.js";
import { makeProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledVisualEvidenceExtractor } from "./import-provider-visual.js";
import { ImportId } from "./import.contracts.js";
import { makeImportWorkflowStarter } from "./import.workflow.js";

const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
);
const reconciliationCorrelationId = Schema.decodeUnknownSync(
  ImportCorrelationId
)("019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1b");
const importId = Schema.decodeUnknownSync(ImportId)(
  "00000000-0000-4000-8000-000000000184"
);
const executionGeneration = Schema.decodeUnknownSync(
  ImportIntentExecutionGeneration
)(1);
const now = Schema.decodeUnknownSync(ProviderAccountingTimestamp)(
  "2026-07-27T20:00:00.000Z"
);
const runId = Schema.decodeUnknownSync(ProviderAccountingRunId)(
  "recipe-import:correlation-proof"
);
const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "organization-observability-proof"
);
const workflowIdentity = Schema.decodeUnknownSync(ImportWorkflowIdentity)(
  `import-acquisition:v1:${"a".repeat(64)}`
);

const repository: ProviderAccountingRepository = {
  beginInvocation: (input) =>
    Effect.succeed({
      _tag: "Claimed",
      dispatch: {
        actualCostMicroUsd: null,
        ...input,
        state: "invoking",
      },
    }),
  readDispatch: (input) =>
    Effect.succeed({
      actualCostMicroUsd: 0,
      ...input,
      state: "settled_known",
    }),
  readStage: () =>
    Effect.succeed({
      budgetCapMicroUsd: 10_000_000,
      reservedMicroUsd: 0,
      settledMicroUsd: 0,
      state: "open",
    }),
  releaseBeforeInvocation: (input) =>
    Effect.succeed({
      actualCostMicroUsd: null,
      ...input,
      state: "released",
    }),
  reserve: (input) =>
    Effect.succeed({
      actualCostMicroUsd: null,
      ...input,
      state: "reserved",
    }),
  settleConservative: (input) =>
    Effect.succeed({
      actualCostMicroUsd: null,
      ...input,
      state: "settled_unknown",
    }),
  settleKnown: (input) =>
    Effect.succeed({
      ...input,
      state: "settled_known",
    }),
  settleUnknown: (input) =>
    Effect.succeed({
      actualCostMicroUsd: null,
      ...input,
      state: "settled_unknown",
    }),
};

const visualProviderResponse = () =>
  Response.json({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({ observations: [] }),
                name: "record_visual_evidence",
              },
              id: "visual-correlation-call-1",
              type: "function",
            },
          ],
        },
      },
    ],
    usage: { completion_tokens: 10, prompt_tokens: 20 },
  });

const testRuntimeContext = RuntimeContext.of({
  Type: "TestRuntimeContext",
  env: {},
  get: <T>() =>
    // eslint-disable-next-line unicorn/no-useless-undefined -- The Alchemy runtime contract explicitly represents a missing binding with undefined.
    Effect.succeed<T | undefined>(undefined),
  id: "installed-provider-correlation-test",
  set: (id) => Effect.succeed(id),
});

const activeInstance = {
  restart: () => Effect.void,
  status: () => Effect.succeed({ status: "running" }),
};

describe("speech recovery workflow restart reconciliation", () => {
  it("accepts an active workflow after a lost restart response", async () => {
    await Promise.all(
      (["queued", "running", "waiting", "waitingForPause"] as const).map(
        async (activeStatus) => {
          let restartCalls = 0;
          let statusReads = 0;
          const starter = makeImportWorkflowStarter({
            createBatch: () => Effect.die("speech recovery must not create"),
            get: () =>
              Effect.succeed({
                restart: () =>
                  Effect.sync(() => {
                    restartCalls += 1;
                  }).pipe(Effect.andThen(Effect.die("response lost"))),
                status: () =>
                  Effect.sync(() => {
                    const status =
                      statusReads === 0 ? "complete" : activeStatus;
                    statusReads += 1;
                    return { status };
                  }),
              }),
          });

          await Effect.runPromise(
            starter.restartFromSpeech?.(workflowIdentity) ??
              Effect.die("missing speech recovery restart")
          );

          expect(restartCalls).toBe(1);
          expect(statusReads).toBe(2);
        }
      )
    );
  });

  it("rejects a terminal instance when restart failed before activation", async () => {
    let restartCalls = 0;
    let statusReads = 0;
    const starter = makeImportWorkflowStarter({
      createBatch: () => Effect.die("speech recovery must not create"),
      get: () =>
        Effect.succeed({
          restart: () =>
            Effect.sync(() => {
              restartCalls += 1;
            }).pipe(Effect.andThen(Effect.die("restart rejected"))),
          status: () =>
            Effect.sync(() => {
              statusReads += 1;
              return { status: "complete" };
            }),
        }),
    });

    await expect(
      Effect.runPromise(
        starter.restartFromSpeech?.(workflowIdentity) ??
          Effect.die("missing speech recovery restart")
      )
    ).rejects.toMatchObject({ _tag: "WorkflowStartUnavailable" });
    expect(restartCalls).toBe(1);
    expect(statusReads).toBe(2);
  });
});

describe("opaque import correlation continuity", () => {
  it("traverses queue, workflow, installed transport, budget and settlement without diverging on reconciliation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const events: ImportObservabilityEvent[] = [];
    const traceStore = ImportObservabilityTraceStore.of({
      append: (event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      read: (id) =>
        Effect.succeed(events.filter((event) => event.correlationId === id)),
    });
    let workflowParams: Schema.Json | undefined;
    const createdStarter = makeImportWorkflowStarter({
      createBatch: (batch) =>
        Effect.sync(() => {
          workflowParams = batch[0]?.params;
          return [activeInstance];
        }),
      get: () => Effect.die("created workflow must not reconcile"),
    });
    const dispatch = makeProviderDispatchGate({
      correlationId,
      now: () => now,
      repository,
      runId,
    });
    let visualProviderCalls = 0;
    const transport = makeVisualTransport(visualProviderResponse, () =>
      Effect.runPromise(
        Effect.sync(() => {
          visualProviderCalls += 1;
        })
      )
    );

    await Effect.runPromise(
      Effect.gen(function* correlatedPath() {
        let creations = 0;
        const trace = yield* observeImportQueueReceipt(() => {
          creations += 1;
          return correlationId;
        });
        expect(creations).toBe(1);
        expect(trace).toEqual({ correlationId });
        yield* createdStarter.dispatchAdmission({
          executionGeneration,
          importId,
          organizationId,
          trace,
          workflowIdentity,
        });
        const input = Schema.decodeUnknownSync(
          Schema.Struct({
            executionGeneration: Schema.Literal(1),
            importId: ImportId,
            organizationId: HouseholdOrganizationId,
            trace: Schema.Struct({ correlationId: ImportCorrelationId }),
          })
        )(workflowParams);
        yield* observeImportWorkflowStart(input.trace);
        const adapter = yield* makeInstalledVisualEvidenceExtractor({
          correlationId: input.trace.correlationId,
          dispatch,
          transport,
        });
        yield* adapter.extract({
          dispatchId: "visual:opaque-import:1",
          frames: [
            {
              bytes: new Uint8Array([1, 2, 3]),
              height: 1,
              mimeType: "image/jpeg",
              sha256: "a".repeat(64),
              timestampMilliseconds: 0,
              width: 1,
            },
          ],
          generation: 1 as never,
          importId: input.importId,
          sourceMediaSha256: "b".repeat(64),
        });
      }).pipe(
        Effect.provideService(ImportObservabilityTraceStore, traceStore),
        Effect.provideService(Tracer.Tracer, tracer),
        Effect.provideService(RuntimeContext, testRuntimeContext)
      )
    );

    expect(events.map((event) => event.event)).toEqual([
      "queue.received",
      "import.accepted",
      "workflow.started",
      "budget.reservation",
      "provider.dispatch",
      "provider.response",
      "provider.decode",
      "provider.settlement",
    ]);
    expect(events.every((event) => event.correlationId === correlationId)).toBe(
      true
    );
    const allowedTraceAttributeKeys = new Set([
      "attempt",
      "correlationId",
      "decodeReason",
      "decodeStage",
      "event",
      "outcome",
      "providerStage",
      "reasonCode",
      "speechEnvelopeFailure",
      "speechEnvelopeFamily",
      "speechEnvelopeUnsupportedLocation",
      "speechEnvelopeUnsupportedRootProperty",
    ]);
    const importSpans = spans.filter(({ name }) => name.startsWith("import."));
    expect(importSpans.length).toBeGreaterThan(0);
    expect(
      importSpans.every((span) =>
        [...span.attributes].every(([key]) =>
          allowedTraceAttributeKeys.has(key)
        )
      )
    ).toBe(true);
    expect(visualProviderCalls).toBe(1);
    expect(JSON.stringify(transport)).not.toMatch(
      /https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );

    const reconciliationStarter = makeImportWorkflowStarter({
      createBatch: () => Effect.succeed([]),
      get: (_id: string) => Effect.succeed(activeInstance),
    });
    await Effect.runPromise(
      Effect.gen(function* reconcileExistingWorkflow() {
        yield* observeImportQueueReceipt(() => reconciliationCorrelationId);
        yield* reconciliationStarter.dispatchAdmission({
          executionGeneration,
          importId,
          organizationId,
          trace: { correlationId: reconciliationCorrelationId },
          workflowIdentity,
        });
      }).pipe(Effect.provideService(ImportObservabilityTraceStore, traceStore))
    );

    const reconciliationEvents = events.filter(
      (event) => event.correlationId === reconciliationCorrelationId
    );
    expect(reconciliationEvents.map((event) => event.event)).toEqual([
      "queue.received",
    ]);
    expect(
      JSON.stringify({
        events,
        logs: log.mock.calls,
      })
    ).not.toMatch(
      /https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );
    expect(
      Schema.is(ImportId)(
        Schema.decodeUnknownSync(Schema.Struct({ importId: ImportId }), {
          onExcessProperty: "ignore",
        })(workflowParams).importId
      )
    ).toBe(true);
    log.mockRestore();
  });

  it("fails closed and redacted when unapproved context reaches observability", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const events: ImportObservabilityEvent[] = [];
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const traceStore = ImportObservabilityTraceStore.of({
      append: (event) =>
        Effect.sync(() => events.push(event)).pipe(Effect.asVoid),
      read: () => Effect.succeed(events),
    });

    await expect(
      Effect.runPromise(
        emitImportObservabilityEvent({
          authorization: "Bearer private-token",
          correlationId,
          event: "workflow.started",
          outcome: "started",
          providerPayload: { transcript: "private transcript" },
          requestBody: { sourceUrl: "https://private.example/tiktok" },
        }).pipe(
          Effect.provideService(ImportObservabilityTraceStore, traceStore),
          Effect.provideService(Tracer.Tracer, tracer)
        )
      )
    ).resolves.toBeUndefined();

    expect(events).toEqual([]);
    expect(log.mock.calls).toEqual([]);
    expect(spans).toEqual([]);
    log.mockRestore();
  });
});
