import { UserId, HouseholdOrganizationId } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

import type { MealPlannerAuthService } from "../auth/auth.alchemy.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { handlePrivateChatRequest } from "./private-chat.http.js";
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
    readonly auth: MealPlannerAuthService;
    readonly household: Pick<
      HouseholdDomainWorkerMethods,
      "listHouseholdPeople" | "readPersonProfile"
    >;
    readonly output: PrivateOutputApiPort;
    readonly request: Request;
  }) {
    const chat = yield* handlePrivateChatRequest(input);
    if (chat !== null) {
      return chat;
    }
    const url = new URL(input.request.url);
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
      // Browser WebSockets cannot attach headers. These are expected identities,
      // never authority: the canonical session and membership reads still decide access.
      const headers = new Headers(input.request.headers);
      if (
        url.searchParams.has("expectedUserId") ||
        url.searchParams.has("expectedOrganizationId")
      ) {
        const expectedUserId = yield* Schema.decodeUnknownEffect(UserId)(
          url.searchParams.get("expectedUserId")
        );
        const expectedOrganizationId = yield* Schema.decodeUnknownEffect(
          HouseholdOrganizationId
        )(url.searchParams.get("expectedOrganizationId"));
        headers.set("x-meal-planner-user", expectedUserId);
        headers.set("x-meal-planner-household", expectedOrganizationId);
      }
      const resolve = () =>
        resolvePrivateOutputAuthority({
          auth: input.auth,
          headers,
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
