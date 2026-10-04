import type { PrivateConfirmationMetadata } from "@meal-planner/private-interview-api";
import {
  PrivateConfirmationApiClient,
  PrivateConfirmationUnauthorized,
  makePrivateConfirmationApiClientLayer,
} from "@meal-planner/private-interview-api";
import { Cause, Effect, Layer, Schema } from "effect";

import { apiHttpLayer } from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";
import { displayedIdentityHeaders } from "../auth/index.js";
import type { DisplayedIdentity } from "../auth/index.js";

export const makePrivateConfirmationEffectOperations = (
  scope: DisplayedIdentity,
  runtime: ApiRuntime
) => {
  const layer = makePrivateConfirmationApiClientLayer({
    baseUrl: runtime.baseUrl,
    headers: displayedIdentityHeaders(scope),
  }).pipe(Layer.provide(apiHttpLayer(runtime)));
  return {
    continue: (metadata: PrivateConfirmationMetadata) =>
      PrivateConfirmationApiClient.use((api) =>
        api.privateConfirmations.continue({
          headers: { "x-private-output-generation": metadata.generation },
          params: {
            mutationId: metadata.mutationId,
            sessionReference: metadata.sessionReference,
          },
        })
      ).pipe(
        Effect.provide(layer),
        Effect.as("accepted" as const),
        Effect.catchCause((cause) => {
          if (Cause.hasInterrupts(cause)) {
            return Effect.failCause(cause);
          }
          const [reason] = cause.reasons;
          return Effect.succeed(
            cause.reasons.length === 1 &&
              reason !== undefined &&
              Cause.isFailReason(reason) &&
              Schema.is(PrivateConfirmationUnauthorized)(reason.error)
              ? ("authentication_required" as const)
              : ("unavailable" as const)
          );
        })
      ),
  };
};

/** The socket owner's foreign callback keeps its lifetime and exact pending command. */
export const continuePrivateConfirmation = (
  metadata: PrivateConfirmationMetadata,
  operations: ReturnType<typeof makePrivateConfirmationEffectOperations>,
  options: { readonly signal: AbortSignal }
) => Effect.runPromise(operations.continue(metadata), options);
