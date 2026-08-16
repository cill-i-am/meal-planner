import { RuntimeContext } from "alchemy";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { Effect, Schema, Tracer } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  makePilotProviderBudgetRuntime,
} from "../pilots/pilot-provider-budget.js";
import type { PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.js";
import type { ImportObservabilityEvent } from "./import-observability.js";
import {
  ImportCorrelationId,
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
  observeImportQueueReceipt,
  observeImportWorkflowStart,
} from "./import-observability.js";
import { makePilotProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledVisualEvidenceExtractor } from "./import-provider-visual.js";
import type { ImportId as ImportIdType } from "./import.contracts.js";
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
const now = Schema.decodeUnknownSync(PilotBudgetTimestamp)(
  "2026-07-27T20:00:00.000Z"
);
const runId = Schema.decodeUnknownSync(PilotBudgetRunId)(
  "gaia-118:correlation-proof"
);

const repository: PilotProviderBudgetRepository = {
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

const gatewayRequests: unknown[] = [];
const gatewayClient = {
  gateway: Effect.die("universal AI Gateway binding must not be used"),
  id: Effect.succeed("meal-planner-pilot-gaia-118"),
  raw: Effect.succeed({
    run: (model: unknown, body: unknown, options: unknown) => {
      gatewayRequests.push({ body, model, options });
      return Promise.resolve(
        Response.json({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({
                        observations: [],
                      }),
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
        })
      );
    },
  }),
  run: () => Effect.die("universal AI Gateway dispatch must not be used"),
} as unknown as QueryGatewayClient;

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
    let workflowParams: unknown;
    const createdStarter = makeImportWorkflowStarter({
      createBatch: (batch) =>
        Effect.sync(() => {
          workflowParams = batch[0]?.params;
          return [activeInstance];
        }),
      get: () => Effect.die("created workflow must not reconcile"),
    });
    const dispatch = makePilotProviderDispatchGate({
      correlationId,
      now: () => now,
      repository,
      runId,
      runtime: makePilotProviderBudgetRuntime("pilot-gaia-118"),
    });

    await Effect.runPromise(
      Effect.gen(function* correlatedPath() {
        let creations = 0;
        const trace = yield* observeImportQueueReceipt(() => {
          creations += 1;
          return correlationId;
        });
        expect(creations).toBe(1);
        expect(trace).toEqual({ correlationId });
        yield* createdStarter.ensureStarted(importId, trace);
        const input = Schema.decodeUnknownSync(
          Schema.Struct({
            importId: ImportId,
            trace: Schema.Struct({ correlationId: ImportCorrelationId }),
          })
        )(workflowParams);
        yield* observeImportWorkflowStart(input.trace);
        const adapter = yield* makeInstalledVisualEvidenceExtractor({
          client: gatewayClient,
          correlationId: input.trace.correlationId,
          dispatch,
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
    expect(gatewayRequests).toHaveLength(1);
    const { options } = Schema.decodeUnknownSync(
      Schema.Struct({
        options: Schema.Struct({
          gateway: Schema.Struct({
            collectLog: Schema.Boolean,
            id: Schema.String,
            skipCache: Schema.Boolean,
          }),
        }),
      })
    )(gatewayRequests[0]);
    expect(options).toEqual({
      gateway: {
        collectLog: false,
        id: "meal-planner-pilot-gaia-118",
        skipCache: true,
      },
    });
    expect(options.gateway).not.toHaveProperty("metadata");
    expect(options).not.toHaveProperty("headers");
    expect(JSON.stringify(options)).not.toMatch(
      /https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );

    const reconciliationStarter = makeImportWorkflowStarter({
      createBatch: () => Effect.succeed([]),
      get: (_id: string) => Effect.succeed(activeInstance),
    });
    await Effect.runPromise(
      Effect.gen(function* reconcileExistingWorkflow() {
        yield* observeImportQueueReceipt(() => reconciliationCorrelationId);
        yield* reconciliationStarter.ensureStarted(importId, {
          correlationId: reconciliationCorrelationId,
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
        (workflowParams as { readonly importId: ImportIdType }).importId
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
