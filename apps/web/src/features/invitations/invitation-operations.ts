import type { InvitationId, UserId } from "@meal-planner/household-api";
import {
  InvitationReadApiClient,
  makeInvitationReadApiClientLayer,
} from "@meal-planner/invitations";
import type { InvitationResponse } from "@meal-planner/invitations";
import { Effect, Layer } from "effect";
import { createEffectQuery } from "effect-query";

import {
  apiHttpLayer,
  transientRetry,
  isTransientHttpFailure,
} from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";

const effectQuery = createEffectQuery(Layer.empty);

/** The query cache owns this recipient-scoped server view. */
export const invitationReadQueryOptions = (
  runtime: ApiRuntime,
  id: InvitationId,
  userId: UserId
) =>
  effectQuery.queryOptions({
    queryFn: () =>
      InvitationReadApiClient.use((api) =>
        api.invitationRead.read({ params: { id } })
      ).pipe(
        Effect.retry({
          ...transientRetry,
          while: (error) =>
            isTransientHttpFailure(error) ||
            error._tag === "InvitationReadUnavailable",
        }),
        Effect.provide(
          makeInvitationReadApiClientLayer({
            baseUrl: runtime.baseUrl,
            headers: { "x-meal-planner-user": userId },
          })
        ),
        Effect.provide(apiHttpLayer(runtime))
      ),
    queryKey: ["setup-invitation", userId, id],
    retry: false,
    staleTime: 0,
  });

export const respondInvitationMutationOptions = (
  runtime: ApiRuntime,
  userId: UserId,
  id: InvitationId
) =>
  effectQuery.mutationOptions({
    mutationFn: (payload: InvitationResponse) =>
      InvitationReadApiClient.use((api) =>
        api.invitationRead.respond({ params: { id }, payload })
      ).pipe(
        Effect.retry({
          ...transientRetry,
          while: (error) =>
            isTransientHttpFailure(error) ||
            error._tag === "InvitationReadUnavailable",
        }),
        Effect.provide(
          makeInvitationReadApiClientLayer({
            baseUrl: runtime.baseUrl,
            headers: { "x-meal-planner-user": userId },
          })
        ),
        Effect.provide(apiHttpLayer(runtime))
      ),
    mutationKey: ["invitation-response", userId, id],
  });
