import { Cause, Console, Context, Effect, Option, Schema } from "effect";

export const ImportCorrelationId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ImportCorrelationId")
);
export type ImportCorrelationId = typeof ImportCorrelationId.Type;

export const ImportObservabilityEventName = Schema.Literals([
  "acquisition.decode",
  "acquisition.dispatch",
  "acquisition.rejection",
  "acquisition.response",
  "acquisition.retry",
  "acquisition.settlement",
  "acquisition.terminal",
  "acquisition.timeout",
  "budget.poison",
  "budget.reservation",
  "import.accepted",
  "provider.decode",
  "provider.dispatch",
  "provider.response",
  "provider.retry",
  "provider.retry_exhausted",
  "provider.settlement",
  "provider.terminal",
  "provider.timeout",
  "queue.received",
  "workflow.started",
]);
export type ImportObservabilityEventName =
  typeof ImportObservabilityEventName.Type;

export const AcquisitionDiagnosticReasonCode = Schema.Literals([
  "container_exit",
  "decode_schema",
  "state_fence",
  "timeout",
  "transport",
  "unsupported_type",
  "validation",
]);
export type AcquisitionDiagnosticReasonCode =
  typeof AcquisitionDiagnosticReasonCode.Type;

export const ImportObservabilityEvent = Schema.Struct({
  attempt: Schema.optionalKey(
    Schema.Number.pipe(
      Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
    )
  ),
  correlationId: ImportCorrelationId,
  event: ImportObservabilityEventName,
  outcome: Schema.optionalKey(
    Schema.Literals([
      "accepted",
      "completed",
      "decoded",
      "exhausted",
      "failed",
      "known",
      "malformed",
      "poisoned",
      "received",
      "reserved",
      "rejected",
      "retrying",
      "settled",
      "started",
      "succeeded",
      "timed_out",
      "unknown",
    ])
  ),
  providerStage: Schema.optionalKey(
    Schema.Literals(["recipe", "speech", "visual"])
  ),
  reasonCode: Schema.optionalKey(AcquisitionDiagnosticReasonCode),
});
export type ImportObservabilityEvent = typeof ImportObservabilityEvent.Type;

export interface ImportObservabilityTraceStoreShape {
  readonly append: (
    event: ImportObservabilityEvent
  ) => Effect.Effect<void, never>;
  readonly read: (
    correlationId: ImportCorrelationId
  ) => Effect.Effect<readonly ImportObservabilityEvent[], never>;
}

export class ImportObservabilityTraceStore extends Context.Service<
  ImportObservabilityTraceStore,
  ImportObservabilityTraceStoreShape
>()("meal-planner/ImportObservabilityTraceStore") {}

const decodeEvent = Schema.decodeUnknownSync(ImportObservabilityEvent, {
  onExcessProperty: "error",
});

export const makeImportCorrelationId = (): ImportCorrelationId =>
  Schema.decodeUnknownSync(ImportCorrelationId)(crypto.randomUUID());

export const metadataOnlyGatewayHeaders = (
  correlationId: ImportCorrelationId
) =>
  ({
    "cf-aig-collect-log": "true",
    "cf-aig-collect-log-payload": "false",
    "cf-aig-metadata": JSON.stringify({ correlationId }),
    "content-type": "application/json",
  }) as const;

const eventAnnotations = (event: ImportObservabilityEvent) => ({
  ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
  correlationId: event.correlationId,
  event: event.event,
  ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
  ...(event.providerStage === undefined
    ? {}
    : { providerStage: event.providerStage }),
  ...(event.reasonCode === undefined ? {} : { reasonCode: event.reasonCode }),
});

/**
 * Emit only the closed, low-cardinality import event contract. The decoder
 * prevents arbitrary source or provider data from entering Worker logs or the
 * app-owned durable trace stream. Platform traces stay disabled because
 * Cloudflare's automatic spans include URL attributes.
 */
export const emitImportObservabilityEvent = (
  rawEvent: unknown,
  capturedTraceStore?: ImportObservabilityTraceStoreShape
) =>
  Effect.suspend(() => {
    const event = decodeEvent(rawEvent);
    const annotations = eventAnnotations(event);
    return Effect.gen(function* emitClosedImportEvent() {
      yield* Console.log(annotations);
      const traceStore =
        capturedTraceStore === undefined
          ? yield* Effect.serviceOption(ImportObservabilityTraceStore)
          : Option.some(capturedTraceStore);
      if (Option.isSome(traceStore)) {
        yield* traceStore.value.append(event);
      }
    }).pipe(
      Effect.withSpan(`import.${event.event}`, { attributes: annotations })
    );
  }).pipe(
    // Logs, spans and trace persistence are diagnostic only. Preserve caller
    // interruption, but prevent any telemetry failure or defect from changing
    // provider, retry or settlement behavior.
    Effect.catchCauseIf(
      (cause) => !Cause.hasInterrupts(cause),
      () => Effect.void
    ),
    Effect.asVoid
  );

export const observeImportQueueReceipt = (
  newCorrelationId: () => ImportCorrelationId = makeImportCorrelationId
) => {
  const correlationId = newCorrelationId();
  return emitImportObservabilityEvent({
    correlationId,
    event: "queue.received",
    outcome: "received",
  }).pipe(Effect.as(correlationId));
};

export const observeImportWorkflowStart = (
  correlationId: ImportCorrelationId
) =>
  emitImportObservabilityEvent({
    correlationId,
    event: "workflow.started",
    outcome: "started",
  });
