import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Redacted } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { makeAuthFamilyHttpLayer } from "../auth-family.js";
import { makeAlchemyMealPlannerAuth } from "../features/auth/auth.alchemy.js";
import * as authSchema from "../features/auth/auth.database-schema.js";
import { makeAuthenticatedOrganizationResolver } from "../features/auth/auth.principal.js";
import type { HouseholdDomainWorkerMethods } from "../features/households/household-domain-worker.js";
import { makeHouseholdInvitationRecipientVerifier } from "../features/households/household-request-composition.js";
import type { MemberDepartureWorkflowStarter } from "../features/households/people/member-departure.js";
import type {
  PrivateOutputApiPort,
  PrivateOutputMutationPort,
} from "../features/private-output/private-output-binding.js";
import { makeAuthOutputFence } from "../features/private-output/private-output-mutation.js";
import { handlePrivateInterviewRequest } from "../features/private-output/private-output.http.js";
import { raceWithRequestSignal } from "../infrastructure/request-cancellation.js";

interface Env {
  readonly BASE_URL: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly MealPlannerAuthDatabase: AnyD1Database;
  readonly HouseholdDomainWorker: object;
  readonly PrivateOutputApi: PrivateOutputApiPort;
  readonly PrivateOutputMutations: PrivateOutputMutationPort;
  readonly TEST_MAIL: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string) => Promise<void>;
  };
}
const context = RuntimeContext.of({
  Type: "AuthFamilyE2E",
  env: {},
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Effect.succeed requires its value argument.
  get: <T>() => Effect.succeed<T | undefined>(undefined),
  id: "auth-family-e2e",
  set: (id) => Effect.succeed(id),
});
// Linked-account departure belongs to another journey. Fail if this suite invokes it.
const departures: MemberDepartureWorkflowStarter = {
  confirmTerminal: () =>
    Effect.die("Linked-account departures are outside this fixture"),
  ensureStarted: () =>
    Effect.die("Linked-account departures are outside this fixture"),
  signalRemovalOutcome: () =>
    Effect.die("Linked-account departures are outside this fixture"),
};
export default {
  fetch: (request: Request, env: Env) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* fetch() {
          const url = new URL(request.url);
          if (url.pathname === "/__test/ready") {
            const ready = yield* Effect.promise(() =>
              env.TEST_MAIL.get("__ready")
            );
            return new Response(ready, { status: ready ? 200 : 503 });
          }
          if (url.pathname === "/__test/mail") {
            const mail = yield* Effect.promise(() =>
              env.TEST_MAIL.get(url.searchParams.get("email") ?? "")
            );
            return new Response(mail, {
              headers: { "content-type": "application/json" },
              status: mail ? 200 : 404,
            });
          }
          const database = drizzle(env.MealPlannerAuthDatabase);
          const domain = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
            env.HouseholdDomainWorker
          );
          const auth = yield* makeAlchemyMealPlannerAuth({
            baseURL: env.BASE_URL,
            database,
            outputFence: makeAuthOutputFence(env.PrivateOutputMutations),
            schema: authSchema,
            secret: Redacted.make(env.BETTER_AUTH_SECRET),
            sendPasswordResetEmail: (mail) =>
              env.TEST_MAIL.put(
                mail.email,
                JSON.stringify({ ...mail, kind: "reset" })
              ),
            verifyInvitationRecipient:
              makeHouseholdInvitationRecipientVerifier(domain),
          });
          if (
            url.pathname === "/__test/expire-session" &&
            request.method === "POST"
          ) {
            const session = yield* auth.api.getSession({
              headers: request.headers,
            });
            if (!session) {
              return new Response(null, { status: 401 });
            }
            yield* Effect.promise(() =>
              database
                .update(authSchema.session)
                .set({ expiresAt: new Date(0) })
                .where(eq(authSchema.session.id, session.session.id))
            );
            return new Response(null, { status: 204 });
          }
          if (url.pathname.startsWith("/api/auth/")) {
            return HttpServerResponse.toWeb(
              yield* auth.fetchHttpEffect(request)
            );
          }
          const privateInterview = yield* handlePrivateInterviewRequest({
            auth,
            household: domain,
            output: env.PrivateOutputApi,
            request,
          });
          if (privateInterview !== null) {
            return privateInterview;
          }
          const resolver = makeAuthenticatedOrganizationResolver({ auth });
          const handler = yield* HttpRouter.toHttpEffect(
            makeAuthFamilyHttpLayer({
              auth,
              database,
              departureWorkflow: departures,
              domain,
              headers: request.headers,
              resolver,
              sendInvitationEmail: (mail) =>
                Effect.promise(() =>
                  env.TEST_MAIL.put(
                    mail.email,
                    JSON.stringify({
                      kind: "invitation",
                      url: `${env.BASE_URL}/invitation/${encodeURIComponent(mail.invitationId)}`,
                    })
                  )
                ).pipe(Effect.asVoid),
            })
          );
          return HttpServerResponse.toWeb(
            yield* raceWithRequestSignal(request.signal, handler).pipe(
              Effect.provideService(
                HttpServerRequest.HttpServerRequest,
                HttpServerRequest.fromWeb(request)
              )
            )
          );
        })
      ).pipe(Effect.provideService(RuntimeContext, context))
    ),
};
