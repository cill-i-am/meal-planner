import { FamilyServiceLive } from "@meal-planner/families/application";
import { InvitationResponseServiceLive } from "@meal-planner/invitations/application";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Redacted } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { makeAlchemyMealPlannerAuth } from "../features/auth/auth.alchemy.js";
import * as authSchema from "../features/auth/auth.database-schema.js";
import { makeAuthenticatedOrganizationResolver } from "../features/auth/auth.principal.js";
import {
  FamilyStoreLive,
  familyHttpApiLayer,
} from "../features/families/index.js";
import type { HouseholdDomainWorkerMethods } from "../features/households/household-domain-worker.js";
import {
  makeHouseholdInvitationRecipientVerifier,
  makeHouseholdPeopleGateway,
  makeHouseholdPeopleRequestLayer,
} from "../features/households/household-request-composition.js";
import {
  HouseholdCreatorLive,
  InvitationMembershipLive,
} from "../features/households/membership.js";
import { makeHouseholdPeopleControlPlane } from "../features/households/people/household-people.control-plane.js";
import type { MemberDepartureWorkflowStarter } from "../features/households/people/member-departure.js";
import {
  InvitationAuthorityLive,
  invitationReadHttpApiLayer,
} from "../features/invitations/index.js";
import type { PrivateOutputMutationPort } from "../features/private-output/private-output-binding.js";
import { makeAuthOutputFence } from "../features/private-output/private-output-mutation.js";

interface Env {
  readonly BASE_URL: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly MealPlannerAuthDatabase: AnyD1Database;
  readonly HouseholdDomainWorker: object;
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
          if (url.pathname.startsWith("/api/auth/")) {
            return HttpServerResponse.toWeb(
              yield* auth.fetchHttpEffect(request)
            );
          }
          const resolver = makeAuthenticatedOrganizationResolver({ auth });
          const gateway = makeHouseholdPeopleGateway({
            controlPlane: makeHouseholdPeopleControlPlane({ auth, database }),
            departureWorkflow: departures,
            domain,
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
          });
          const family = FamilyServiceLive.pipe(
            Layer.provide(HouseholdCreatorLive(domain)),
            Layer.provide(FamilyStoreLive(database))
          );
          const invitations = InvitationResponseServiceLive.pipe(
            Layer.provide(InvitationAuthorityLive(auth, request.headers)),
            Layer.provide(
              InvitationMembershipLive(gateway, resolver, request.headers)
            )
          );
          const handler = yield* HttpRouter.toHttpEffect(
            Layer.mergeAll(
              familyHttpApiLayer(auth).pipe(
                Layer.provide(family),
                HttpRouter.provideRequest(family)
              ),
              invitationReadHttpApiLayer(auth).pipe(
                Layer.provide(invitations),
                HttpRouter.provideRequest(invitations)
              ),
              makeHouseholdPeopleRequestLayer({ gateway, resolver })
            )
          );
          return HttpServerResponse.toWeb(
            yield* handler.pipe(
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
