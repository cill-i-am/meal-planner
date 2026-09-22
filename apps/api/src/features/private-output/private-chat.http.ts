import { PersonProfile } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

import type { MealPlannerAuthService } from "../auth/auth.alchemy.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { PrivateChatContext } from "./private-chat.contract.js";
import type { PrivateOutputApiPort } from "./private-output-binding.js";
import { resolvePrivateOutputAuthority } from "./private-output.authority.js";

const Id = Schema.String.pipe(Schema.check(Schema.isUUID()));
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

/** Authenticate each native TanStack request before the private worker sees it. */
export const handlePrivateChatRequest = Effect.fn(
  function* handlePrivateChatRequest(input: {
    readonly auth: MealPlannerAuthService;
    readonly household: Pick<
      HouseholdDomainWorkerMethods,
      "listHouseholdPeople" | "readPersonProfile"
    >;
    readonly output: Pick<PrivateOutputApiPort, "fetch">;
    readonly request: Request;
  }) {
    const { request } = input;
    const url = new URL(request.url);
    const match =
      /^\/v1\/private-interviews\/(?<sessionReference>[^/]+)\/chat$/u.exec(
        url.pathname
      );
    if (match === null) {
      return null;
    }
    const origin = request.headers.get("Origin");
    const site = request.headers.get("Sec-Fetch-Site");
    if (
      !["GET", "POST", "DELETE"].includes(request.method) ||
      (origin !== null && origin !== url.origin) ||
      (request.method !== "GET" && origin !== url.origin) ||
      (site !== null && site !== "same-origin" && site !== "none") ||
      (request.method === "POST" &&
        request.headers.get("Content-Type")?.split(";")[0]?.trim() !==
          "application/json")
    ) {
      return new Response(null, { status: 403 });
    }
    return yield* Effect.gen(function* admitPrivateChatRequest() {
      const sessionReference = yield* Schema.decodeUnknownEffect(Id)(
        match.groups?.["sessionReference"]
      );
      const generation = yield* Schema.decodeUnknownEffect(Id)(
        request.headers.get("x-private-output-generation")
      );
      const current = yield* resolvePrivateOutputAuthority({
        auth: input.auth,
        headers: request.headers,
        household: input.household,
      });
      const profile =
        request.method === "POST"
          ? yield* input.household
              .readPersonProfile({
                admission: current.admission,
                personId: current.personId,
                version: null,
              })
              .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PersonProfile)))
          : null;
      const context = yield* Schema.decodeUnknownEffect(PrivateChatContext)({
        binding: {
          accountKey: current.accountKey,
          householdKey: current.householdKey,
          linkageSubject: current.linkageSubject,
          personId: current.personId,
          sessionReference,
        },
        generation,
        profile,
      });
      const target = new URL("https://private-output.internal/chat");
      target.search = url.search;
      // Only protocol metadata crosses this boundary; cookies and client-supplied
      // internal authority headers are never forwarded to the private worker.
      const headers = new Headers({
        "private-output-session": sessionReference,
      });
      for (const name of ["Last-Event-ID", "X-Run-Id"]) {
        const value = request.headers.get(name);
        if (value !== null) {
          headers.set(name, value);
        }
      }
      let body: string | undefined;
      if (request.method === "POST") {
        const payload = yield* Effect.tryPromise(() => request.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(JsonObject)),
          Effect.catchCause(() => Effect.succeed(null))
        );
        if (payload === null) {
          return new Response(null, { status: 400 });
        }
        // Keep the library's native request intact and replace any forged context.
        body = JSON.stringify({ ...payload, privateChatContext: context });
        headers.set("Content-Type", "application/json");
      } else {
        if (request.body !== null) {
          return new Response(null, { status: 403 });
        }
        headers.set(
          "private-chat-context",
          encodeURIComponent(JSON.stringify(context))
        );
      }
      const forwarded: RequestInit = { headers, method: request.method };
      if (body !== undefined) {
        forwarded.body = body;
      }
      return yield* Effect.tryPromise(() =>
        input.output.fetch(new Request(target, forwarded))
      ).pipe(
        Effect.catchCause(() =>
          Effect.succeed(new Response(null, { status: 503 }))
        )
      );
    }).pipe(
      Effect.catchCause(() =>
        Effect.succeed(new Response(null, { status: 403 }))
      )
    );
  }
);
