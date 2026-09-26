import {
  makeSetupFamilyApiClientLayer,
  SetupFamilyApiClient,
} from "@meal-planner/household-api";
import type {
  CreateSetupFamilyRequest,
  UserId,
} from "@meal-planner/household-api";
import { Effect } from "effect";
import { createEffectQuery } from "effect-query";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

const effectQuery = createEffectQuery(FetchHttpClient.layer);

/** The generated client owns request encoding and typed error decoding. */
export const familyCreationMutationOptions = (userId: typeof UserId.Type) =>
  effectQuery.mutationOptions({
    mutationFn: (input: typeof CreateSetupFamilyRequest.Type) =>
      SetupFamilyApiClient.use((api) =>
        api.setupFamily.create({ payload: input })
      ).pipe(
        Effect.provide(
          makeSetupFamilyApiClientLayer({
            baseUrl: window.location.origin,
            headers: { "x-meal-planner-user": userId },
          })
        )
      ),
    mutationKey: ["createSetupFamily"],
  });
