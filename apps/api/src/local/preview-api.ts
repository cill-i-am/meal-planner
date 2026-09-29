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

import { handleAgentConversationChatRequest } from "../agent-conversations.js";
import type { AgentConversationNamespace } from "../agent-conversations.js";
import { makeAlchemyMealPlannerAuth } from "../features/auth/auth.alchemy.js";
import * as authSchema from "../features/auth/auth.database-schema.js";
import {
  AuthPrincipalResolver,
  AuthenticatedOrganizationResolver,
  makeAuthPrincipalResolver,
  makeAuthenticatedOrganizationResolver,
} from "../features/auth/auth.principal.js";
import type { HouseholdDomainWorkerMethods } from "../features/households/household-domain-worker.js";
import { makeHouseholdInvitationRecipientVerifier } from "../features/households/household-request-composition.js";
import type { MemberDepartureWorkflowStarter } from "../features/households/people/member-departure.js";
import { MemberDepartureWorkflowUnavailable } from "../features/households/people/member-departure.js";
import {
  makeRecipeReadHttpApiLayer,
  RecipeImportHouseholdDomain,
} from "../features/imports/import-intent-api.http.js";
import type {
  PrivateOutputApiPort,
  PrivateOutputMutationPort,
} from "../features/private-output/private-output-binding.js";
import { makeAuthOutputFence } from "../features/private-output/private-output-mutation.js";
import { handlePrivateInterviewRequest } from "../features/private-output/private-output.http.js";
import { raceWithRequestSignal } from "../infrastructure/request-cancellation.js";
import { makeLocalApiCoreLayer } from "./api-core.js";

interface LocalMailCapture {
  readonly put: (key: string, value: string) => Promise<void>;
}

/** Bound only by the loopback-only local preview launcher. */
export interface LocalPreviewEnv {
  readonly AgentConversation: AgentConversationNamespace;
  readonly BASE_URL: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly HouseholdDomainWorker: object;
  readonly LOCAL_MAIL: LocalMailCapture;
  readonly MealPlannerAuthDatabase: AnyD1Database;
  readonly PrivateOutputApi: PrivateOutputApiPort;
  readonly PrivateOutputMutations: PrivateOutputMutationPort;
}

export { AgentConversation } from "../features/agent-conversations/index.js";

const runtimeContext = RuntimeContext.of({
  Type: "LocalLivePreview",
  env: {},
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Effect.succeed requires its value argument.
  get: <T>() => Effect.succeed<T | undefined>(undefined),
  id: "meal-planner-local-live-preview",
  set: (id) => Effect.succeed(id),
});

const localDepartureUnavailable: MemberDepartureWorkflowStarter = {
  confirmTerminal: () => Effect.fail(new MemberDepartureWorkflowUnavailable()),
  ensureStarted: () => Effect.fail(new MemberDepartureWorkflowUnavailable()),
  signalRemovalOutcome: () =>
    Effect.fail(new MemberDepartureWorkflowUnavailable()),
};

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Real application handlers with a real Agent and no test-control routes. */
export default {
  fetch: (request: Request, env: LocalPreviewEnv) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* fetchLocalPreview() {
          const url = new URL(request.url);
          const baseUrl = new URL(env.BASE_URL);
          if (
            !loopbackHosts.has(baseUrl.hostname) ||
            url.origin !== baseUrl.origin
          ) {
            return new Response(null, {
              headers: { "cache-control": "no-store" },
              status: 403,
            });
          }
          if (url.pathname === "/__local/ready" && request.method === "GET") {
            return Response.json(
              { ready: true },
              { headers: { "cache-control": "no-store" } }
            );
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
              env.LOCAL_MAIL.put(
                `reset:${mail.email}`,
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
          const sendInvitationEmail = (mail: {
            readonly email: string;
            readonly invitationId: string;
          }) =>
            Effect.promise(() =>
              env.LOCAL_MAIL.put(
                `invitation:${mail.email}`,
                JSON.stringify({
                  kind: "invitation",
                  url: `${env.BASE_URL}/invitation/${encodeURIComponent(mail.invitationId)}`,
                })
              )
            ).pipe(Effect.asVoid);
          const options = {
            auth,
            conversations: env.AgentConversation,
            database,
            departureWorkflow: localDepartureUnavailable,
            domain,
            headers: request.headers,
            resolver,
            sendInvitationEmail,
          };
          const chat = yield* handleAgentConversationChatRequest({
            ...options,
            request,
          }).pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              HttpServerRequest.fromWeb(request)
            )
          );
          if (chat !== null) {
            return chat;
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
          const recipeReadServices = Layer.mergeAll(
            Layer.succeed(
              AuthPrincipalResolver,
              makeAuthPrincipalResolver({ auth })
            ),
            Layer.succeed(AuthenticatedOrganizationResolver, resolver),
            Layer.succeed(RecipeImportHouseholdDomain, domain)
          );
          const handler = yield* HttpRouter.toHttpEffect(
            Layer.mergeAll(
              makeLocalApiCoreLayer(options),
              makeRecipeReadHttpApiLayer().pipe(
                Layer.provide(recipeReadServices),
                HttpRouter.provideRequest(recipeReadServices)
              )
            )
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
      ).pipe(Effect.provideService(RuntimeContext, runtimeContext))
    ),
};
