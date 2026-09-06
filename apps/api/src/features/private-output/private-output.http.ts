import { InterviewProfileOutcome } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

import type { MealPlannerAuth } from "../auth/auth.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { ReleasedConfirmation } from "./private-confirmation.contract.js";
import type { PrivateOutputApiPort } from "./private-output-binding.js";
import { resolvePrivateOutputAuthority } from "./private-output.authority.js";
import {
  PrivateOutputUnavailable,
  privateDirectoryKey,
} from "./private-output.contract.js";

const SessionReference = Schema.String.pipe(Schema.check(Schema.isUUID()));

/** Only this authenticated route can invoke the named session-admission capability. */
export const handlePrivateInterviewRequest = Effect.fn(
  function* handlePrivateInterviewRequest(input: {
    readonly auth: MealPlannerAuth;
    readonly household: Pick<
      HouseholdDomainWorkerMethods,
      "listHouseholdPeople" | "mutateInterviewProfile"
    >;
    readonly output: PrivateOutputApiPort;
    readonly request: Request;
  }) {
    const url = new URL(input.request.url);
    const confirmation =
      /^\/v1\/private-interviews\/(?<sessionReference>[^/]+)\/confirmations\/(?<mutationId>[^/]+)$/u.exec(
        url.pathname
      );
    if (confirmation !== null) {
      if (
        input.request.method !== "POST" ||
        input.request.headers.get("Origin") !== url.origin
      ) {
        return new Response(null, { status: 403 });
      }
      return yield* Effect.gen(function* continueConfirmation() {
        // No private HTTP payload or response body is accepted by this continuation.
        const { body } = input.request;
        if (body !== null) {
          const empty = yield* Effect.tryPromise(async () => {
            const reader = body.getReader();
            const first = await reader.read();
            await reader.cancel();
            return first.done;
          });
          if (!empty) {
            return new Response(null, { status: 403 });
          }
        }
        const sessionReference = yield* Schema.decodeUnknownEffect(
          SessionReference
        )(confirmation.groups?.["sessionReference"]);
        const mutationId = yield* Schema.decodeUnknownEffect(SessionReference)(
          confirmation.groups?.["mutationId"]
        );
        const generation = yield* Schema.decodeUnknownEffect(SessionReference)(
          input.request.headers.get("x-private-output-generation")
        );
        const current = yield* resolvePrivateOutputAuthority({
          auth: input.auth,
          headers: input.request.headers,
          household: input.household,
        });
        const binding = {
          accountKey: current.accountKey,
          householdKey: current.householdKey,
          linkageSubject: current.linkageSubject,
          personId: current.personId,
          sessionReference,
        };
        const released = yield* Effect.tryPromise(() =>
          input.output.releaseConfirmation({ binding, generation, mutationId })
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(ReleasedConfirmation))
        );
        if (released.type === "settled") {
          return new Response(null, { status: 204 });
        }
        const outcome = yield* input.household
          .mutateInterviewProfile({
            admission: current.admission,
            payload: released.payload,
            personId: current.personId,
          })
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(InterviewProfileOutcome))
          );
        yield* Effect.tryPromise(() =>
          input.output.settleConfirmation({
            binding,
            generation: released.generation,
            mutationId,
            outcome,
          })
        );
        return new Response(null, { status: 204 });
      }).pipe(
        Effect.catchCause(() =>
          Effect.succeed(new Response(null, { status: 503 }))
        )
      );
    }
    const match =
      /^\/v1\/private-interviews\/(?<sessionReference>[^/]+)\/connect$/u.exec(
        url.pathname
      );
    const isDirectory =
      url.pathname === "/v1/private-interviews/directory/connect";
    if (match === null && !isDirectory) {
      return null;
    }
    if (
      input.request.method !== "GET" ||
      input.request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
      input.request.headers.get("Origin") !== url.origin
    ) {
      return new Response(null, { status: 403 });
    }
    return yield* Effect.gen(function* resolvePrivateInterviewRequest() {
      const sessionReference = isDirectory
        ? undefined
        : yield* Schema.decodeUnknownEffect(SessionReference)(
            match?.groups?.["sessionReference"]
          );
      const resolve = () =>
        resolvePrivateOutputAuthority({
          auth: input.auth,
          headers: input.request.headers,
          household: input.household,
        });
      const initial = yield* resolve();
      const generation = yield* Effect.tryPromise({
        catch: () =>
          new PrivateOutputUnavailable({ reason: "output_disabled" }),
        try: () =>
          sessionReference === undefined
            ? input.output.beginDirectoryConnection({
                accountKey: initial.accountKey,
                householdKey: initial.householdKey,
                linkageSubject: initial.linkageSubject,
                personId: initial.personId,
              })
            : input.output.beginConnection({
                accountKey: initial.accountKey,
                householdKey: initial.householdKey,
                linkageSubject: initial.linkageSubject,
                personId: initial.personId,
                sessionReference,
              }),
      });
      // Both durable registrations exist before these final canonical reads.
      const current = yield* resolve();
      yield* Effect.tryPromise({
        catch: () =>
          new PrivateOutputUnavailable({ reason: "output_disabled" }),
        try: () =>
          sessionReference === undefined
            ? input.output.authorizeDirectoryConnection({
                binding: {
                  accountKey: current.accountKey,
                  householdKey: current.householdKey,
                  linkageSubject: current.linkageSubject,
                  personId: current.personId,
                },
                expiresAt: current.expiresAt,
                generation,
              })
            : input.output.authorizeConnection({
                binding: {
                  accountKey: current.accountKey,
                  householdKey: current.householdKey,
                  linkageSubject: current.linkageSubject,
                  personId: current.personId,
                  sessionReference,
                },
                expiresAt: current.expiresAt,
                generation,
              }),
      });
      const target =
        sessionReference === undefined
          ? {
              "private-output-directory": yield* Effect.promise(() =>
                privateDirectoryKey(current)
              ),
            }
          : { "private-output-session": sessionReference };
      return yield* Effect.tryPromise({
        catch: () =>
          new PrivateOutputUnavailable({ reason: "output_disabled" }),
        try: () =>
          input.output.fetch(
            new Request("https://private-output.internal/upgrade", {
              headers: {
                Upgrade: "websocket",
                "private-output-generation": generation,
                ...target,
              },
            })
          ),
      });
    }).pipe(
      Effect.catchCause(() =>
        Effect.succeed(new Response(null, { status: 403 }))
      )
    );
  }
);
