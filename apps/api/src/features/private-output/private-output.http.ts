import { Effect, Schema } from "effect";

import type { MealPlannerAuth } from "../auth/auth.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import type { PrivateOutputApiPort } from "./private-output-binding.js";
import { resolvePrivateOutputAuthority } from "./private-output.authority.js";
import { PrivateOutputUnavailable } from "./private-output.contract.js";

const SessionReference = Schema.String.pipe(Schema.check(Schema.isUUID()));

/** Only this authenticated route can invoke the named session-admission capability. */
export const handlePrivateInterviewRequest = Effect.fn(
  function* handlePrivateInterviewRequest(input: {
    readonly auth: MealPlannerAuth;
    readonly household: Pick<
      HouseholdDomainWorkerMethods,
      "listHouseholdPeople"
    >;
    readonly output: PrivateOutputApiPort;
    readonly request: Request;
  }) {
    const url = new URL(input.request.url);
    const match =
      /^\/v1\/private-interviews\/(?<sessionReference>[^/]+)\/connect$/u.exec(
        url.pathname
      );
    if (match === null) {
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
      const sessionReference = yield* Schema.decodeUnknownEffect(
        SessionReference
      )(match.groups?.["sessionReference"]);
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
          input.output.beginConnection({
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
          input.output.authorizeConnection({
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
      return yield* Effect.tryPromise({
        catch: () =>
          new PrivateOutputUnavailable({ reason: "output_disabled" }),
        try: () =>
          input.output.fetch(
            new Request("https://private-output.internal/upgrade", {
              headers: {
                Upgrade: "websocket",
                "private-output-generation": generation,
                "private-output-session": sessionReference,
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
