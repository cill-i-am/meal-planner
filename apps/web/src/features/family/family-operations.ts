import {
  FamilyApiClient,
  FamilyUnavailable,
  makeFamilyApiClientLayer,
} from "@meal-planner/families";
import type {
  HouseholdOrganizationId,
  UserId,
} from "@meal-planner/household-api";
import { Effect, Schedule, Schema } from "effect";
import { createEffectQuery } from "effect-query";
import { HttpClientError } from "effect/unstable/http";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

export const familyEffectQuery = createEffectQuery(FetchHttpClient.layer);
export const familyKeys = {
  all: (userId: UserId) => ["families", userId] as const,
  detail: (userId: UserId, familyId: HouseholdOrganizationId | undefined) =>
    ["families", userId, familyId, "detail"] as const,
  list: (userId: UserId) => ["families", userId, "list"] as const,
  people: (userId: UserId, familyId: HouseholdOrganizationId | undefined) =>
    ["families", userId, familyId, "people"] as const,
};
export const familyOperation = <A, E>(
  userId: UserId,
  run: (api: FamilyApiClient) => Effect.Effect<A, E>
) =>
  FamilyApiClient.use(run).pipe(
    Effect.retry({
      schedule: Schedule.exponential("200 millis").pipe(Schedule.jittered),
      times: 2,
      while: (error) =>
        (HttpClientError.isHttpClientError(error) &&
          (error.reason._tag === "TransportError" ||
            (error.reason._tag === "StatusCodeError" &&
              error.reason.response.status >= 500))) ||
        Schema.is(FamilyUnavailable)(error),
    }),
    Effect.provide(
      makeFamilyApiClientLayer({
        baseUrl: window.location.origin,
        headers: { "x-meal-planner-user": userId },
      })
    )
  );
export const familyListQuery = (userId: UserId) =>
  familyEffectQuery.queryOptions({
    queryFn: () => familyOperation(userId, (api) => api.families.list()),
    queryKey: familyKeys.list(userId),
    retry: false,
  });
export const familyQuery = (
  userId: UserId,
  familyId: HouseholdOrganizationId | undefined
) =>
  familyEffectQuery.queryOptions({
    enabled: familyId !== undefined,
    queryFn: () => {
      if (familyId === undefined) {
        throw new Error("A family is required.");
      }
      return familyOperation(userId, (api) =>
        api.families.get({ params: { familyId } })
      );
    },
    queryKey: familyKeys.detail(userId, familyId),
    retry: false,
  });
