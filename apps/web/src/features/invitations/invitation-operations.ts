import type { InvitationId, UserId } from "@meal-planner/household-api";
import {
  InvitationReadApiClient,
  makeInvitationReadApiClientLayer,
} from "@meal-planner/invitations";
import type { InvitationResponse } from "@meal-planner/invitations";
import { Effect, Schedule } from "effect";
import { createEffectQuery } from "effect-query";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

const effectQuery = createEffectQuery(FetchHttpClient.layer);

/** The query cache owns this recipient-scoped server view. */
export const invitationReadQueryOptions = (id: InvitationId, userId: UserId) =>
  effectQuery.queryOptions({
    queryFn: () =>
      InvitationReadApiClient.use((api) =>
        api.invitationRead.read({ params: { id } })
      ).pipe(
        Effect.provide(
          makeInvitationReadApiClientLayer({
            baseUrl: window.location.origin,
            headers: { "x-meal-planner-user": userId },
          })
        )
      ),
    queryKey: ["setup-invitation", userId, id],
    retry: false,
    staleTime: 0,
  });

export const respondInvitationMutationOptions = (
  userId: UserId,
  id: InvitationId
) =>
  effectQuery.mutationOptions({
    mutationFn: (payload: InvitationResponse) =>
      InvitationReadApiClient.use((api) =>
        api.invitationRead.respond({ params: { id }, payload })
      ).pipe(
        Effect.retry({
          schedule: Schedule.exponential("200 millis").pipe(Schedule.jittered),
          times: 2,
          while: (error) => error._tag === "InvitationReadUnavailable",
        }),
        Effect.provide(
          makeInvitationReadApiClientLayer({
            baseUrl: window.location.origin,
            headers: { "x-meal-planner-user": userId },
          })
        )
      ),
    mutationKey: ["invitation-response", userId, id],
  });
