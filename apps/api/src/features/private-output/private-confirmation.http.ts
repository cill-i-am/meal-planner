import { InterviewProfileOutcome } from "@meal-planner/household-api";
import {
  PrivateConfirmationApi,
  PrivateConfirmationForbidden,
  PrivateConfirmationRequestGuard,
  PrivateConfirmationUnavailable,
} from "@meal-planner/private-interview-api";
import { Cause, Effect, Layer, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";

import { JsonHttpPlatformServices } from "../../infrastructure/json-http-platform.js";
import type { MealPlannerAuthService } from "../auth/auth.alchemy.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { ReleasedConfirmation } from "./private-confirmation.contract.js";
import type { PrivateOutputApiPort } from "./private-output-binding.js";
import { resolvePrivateOutputAuthority } from "./private-output.authority.js";

/** Read at most one chunk; never accept a caller-supplied profile command. */
const hasEmptyBody = (request: Request) =>
  Effect.tryPromise({
    catch: () => PrivateConfirmationUnavailable.make({}),
    try: async () => {
      if (request.body === null) {
        return true;
      }
      const reader = request.body.getReader();
      try {
        const result = await reader.read();
        return result.done === true;
      } finally {
        await reader.cancel();
      }
    },
  });

const RequestGuardLive = Layer.succeed(
  PrivateConfirmationRequestGuard,
  (httpEffect) =>
    Effect.gen(function* guardPrivateConfirmation() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const web = yield* HttpServerRequest.toWeb(request).pipe(
        Effect.mapError(() => PrivateConfirmationUnavailable.make({}))
      );
      if (
        web.headers.get("Origin") !== new URL(web.url).origin ||
        !(yield* hasEmptyBody(web))
      ) {
        return yield* Effect.fail(PrivateConfirmationForbidden.make({}));
      }
      return yield* httpEffect;
    }).pipe(
      // eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- Effect catches typed schema failures without creating a Promise bridge.
      Effect.catch((error) =>
        HttpApiError.HttpApiSchemaError.is(error)
          ? Effect.fail(PrivateConfirmationForbidden.make({}))
          : Effect.fail(error)
      ),
      Effect.catchCauseIf(
        (cause) => Cause.hasDies(cause) && !Cause.hasInterrupts(cause),
        () => Effect.fail(PrivateConfirmationUnavailable.make({}))
      )
    )
);

/** Household authority applies the frozen command; the session owns its receipt and recovery. */
export const makePrivateConfirmationHttpLayer = (input: {
  readonly auth: MealPlannerAuthService;
  readonly household: Pick<
    HouseholdDomainWorkerMethods,
    "listHouseholdPeople" | "mutateInterviewProfile"
  >;
  readonly output: Pick<
    PrivateOutputApiPort,
    "releaseConfirmation" | "settleConfirmation"
  >;
}) =>
  HttpApiBuilder.layer(PrivateConfirmationApi).pipe(
    Layer.provide(
      HttpApiBuilder.group(
        PrivateConfirmationApi,
        "privateConfirmations",
        (handlers) =>
          handlers.handle("continue", ({ headers, params }) =>
            Effect.gen(function* continuePrivateConfirmation() {
              const request = yield* HttpServerRequest.HttpServerRequest;
              const current = yield* resolvePrivateOutputAuthority({
                ...input,
                headers: new Headers(Object.entries(request.headers)),
              });
              const binding = {
                accountKey: current.accountKey,
                householdKey: current.householdKey,
                linkageSubject: current.linkageSubject,
                personId: current.personId,
                sessionReference: params.sessionReference,
              };
              const released = yield* Effect.tryPromise(() =>
                input.output.releaseConfirmation({
                  binding,
                  generation: headers["x-private-output-generation"],
                  mutationId: params.mutationId,
                })
              ).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(ReleasedConfirmation))
              );
              if (released.type === "settled") {
                return;
              }
              const outcome = yield* input.household
                .mutateInterviewProfile({
                  admission: current.admission,
                  payload: released.payload,
                  personId: current.personId,
                })
                .pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(InterviewProfileOutcome)
                  )
                );
              yield* Effect.tryPromise(() =>
                input.output.settleConfirmation({
                  binding,
                  generation: released.generation,
                  mutationId: params.mutationId,
                  outcome,
                })
              );
            }).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause)
                  ? Effect.failCause(
                      cause.pipe(
                        Cause.map(() => PrivateConfirmationUnavailable.make({}))
                      )
                    )
                  : Effect.fail(PrivateConfirmationUnavailable.make({}))
              )
            )
          )
      )
    ),
    Layer.provide(RequestGuardLive),
    Layer.provide(JsonHttpPlatformServices)
  );
