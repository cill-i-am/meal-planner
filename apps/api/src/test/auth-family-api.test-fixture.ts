import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Redacted, Result, Schema } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { handleAgentConversationChatRequest } from "../agent-conversations.js";
import type { AgentConversationNamespace } from "../agent-conversations.js";
import { conversationObjectName } from "../features/agent-conversations/conversation-session.js";
import { ConversationAccess } from "../features/agent-conversations/conversation.contract.js";
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
import { HouseholdMemberAdmission } from "../features/households/rpc/command-envelope.js";
import {
  makeRecipeImportHttpApiLayer,
  RecipeImportHouseholdDomain,
} from "../features/imports/import-intent-api.http.js";
import { RecipeImportWorkflowDispatcher } from "../features/imports/import-workflow-dispatcher.js";
import type {
  PrivateOutputApiPort,
  PrivateOutputMutationPort,
} from "../features/private-output/private-output-binding.js";
import { makeAuthOutputFence } from "../features/private-output/private-output-mutation.js";
import { handlePrivateInterviewRequest } from "../features/private-output/private-output.http.js";
import { raceWithRequestSignal } from "../infrastructure/request-cancellation.js";
import { makeLocalApiCoreLayer } from "../local/api-core.js";
import { seedNativeRecipe } from "./agent-conversation-recipe-seed.test-fixture.js";

interface Env {
  readonly BASE_URL: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly MealPlannerAuthDatabase: AnyD1Database;
  readonly HouseholdDomainWorker: object;
  readonly AgentConversation: Omit<AgentConversationNamespace, "getByName"> & {
    readonly getByName: (name: string) => ReturnType<
      AgentConversationNamespace["getByName"]
    > & {
      readonly armLostAdvance: (step: number) => Promise<void>;
    };
  };
  readonly PrivateOutputApi: PrivateOutputApiPort;
  readonly PrivateOutputMutations: PrivateOutputMutationPort;
  readonly TEST_MAIL: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string) => Promise<void>;
  };
}
export { AgentConversation } from "./agent-conversation-control.test-fixture.js";
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
const isRecipeSeedRequest = (path: string, method: string) =>
  path === "/__test/conversation/seed-recipe" && method === "POST";
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
              yield* makeHouseholdInvitationRecipientVerifier(domain),
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
          if (
            url.pathname === "/__test/conversation/lose-next-advance" &&
            request.method === "POST"
          ) {
            const session = yield* auth.api.getSession({
              headers: request.headers,
            });
            if (session === null) {
              return new Response(null, { status: 401 });
            }
            const digest = yield* Effect.promise(() =>
              crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(session.user.id)
              )
            );
            const accountKey = Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, "0")
            ).join("");
            const access = Schema.decodeUnknownSync(ConversationAccess)({
              accountKey,
              scope: { _tag: "AccountPrivateSetup" },
            });
            const name = yield* Effect.promise(() =>
              conversationObjectName(access)
            );
            const stub = env.AgentConversation.getByName(name);
            yield* Effect.promise(() => stub.armLostAdvance(0));
            return new Response(null, { status: 204 });
          }
          if (
            url.pathname === "/__test/conversation/add-unlinked-membership" &&
            request.method === "POST"
          ) {
            const session = yield* auth.api.getSession({
              headers: request.headers,
            });
            if (session === null) {
              return new Response(null, { status: 401 });
            }
            const body = yield* Effect.promise(() => request.json());
            const { familyId } = Schema.decodeUnknownSync(
              Schema.Struct({ familyId: HouseholdOrganizationId })
            )(body);
            yield* Effect.promise(() =>
              database.insert(authSchema.member).values({
                createdAt: new Date(),
                id: crypto.randomUUID(),
                organizationId: familyId,
                role: "member",
                userId: session.user.id,
              })
            );
            return new Response(null, { status: 204 });
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
          const importServices = Layer.mergeAll(
            Layer.succeed(
              AuthPrincipalResolver,
              makeAuthPrincipalResolver({ auth })
            ),
            Layer.succeed(AuthenticatedOrganizationResolver, resolver),
            Layer.succeed(RecipeImportHouseholdDomain, domain),
            Layer.succeed(
              RecipeImportWorkflowDispatcher,
              RecipeImportWorkflowDispatcher.of({
                dispatch: () =>
                  Effect.die("Recipe import dispatch is outside this fixture"),
              })
            )
          );
          const sendInvitationEmail = (mail: {
            readonly email: string;
            readonly invitationId: string;
          }) =>
            Effect.promise(() =>
              env.TEST_MAIL.put(
                mail.email,
                JSON.stringify({
                  kind: "invitation",
                  url: `${env.BASE_URL}/invitation/${encodeURIComponent(mail.invitationId)}`,
                })
              )
            ).pipe(Effect.asVoid);
          const conversationOptions = {
            auth,
            conversations: env.AgentConversation,
            database,
            departureWorkflow: departures,
            domain,
            headers: request.headers,
            resolver,
            sendInvitationEmail,
          };
          if (isRecipeSeedRequest(url.pathname, request.method)) {
            const outcome = yield* Effect.result(
              Effect.gen(function* seedAdmittedRecipe() {
                const body = Schema.decodeUnknownSync(
                  Schema.Struct({ familyId: HouseholdOrganizationId })
                )(yield* Effect.promise(() => request.json()));
                yield* resolver.resolve(request.headers, body.familyId);
                const principal = yield* makeAuthPrincipalResolver({
                  auth,
                }).resolve(request.headers);
                const admission = Schema.decodeUnknownSync(
                  HouseholdMemberAdmission
                )({
                  actor: { _tag: "Member", actorId: principal.actorId },
                  organizationId: body.familyId,
                });
                return yield* seedNativeRecipe(domain, admission);
              })
            );
            return Result.isSuccess(outcome)
              ? Response.json(outcome.success, { status: 201 })
              : Response.json(
                  {
                    error:
                      outcome.failure instanceof Error
                        ? outcome.failure.message
                        : JSON.stringify(outcome.failure),
                  },
                  { status: 500 }
                );
          }
          const conversationResponse =
            yield* handleAgentConversationChatRequest({
              ...conversationOptions,
              request,
            }).pipe(
              Effect.provideService(
                HttpServerRequest.HttpServerRequest,
                HttpServerRequest.fromWeb(request)
              )
            );
          if (conversationResponse !== null) {
            return conversationResponse;
          }
          const handler = yield* HttpRouter.toHttpEffect(
            Layer.mergeAll(
              makeLocalApiCoreLayer(conversationOptions),
              makeRecipeImportHttpApiLayer().pipe(
                Layer.provide(importServices),
                HttpRouter.provideRequest(importServices)
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
      ).pipe(Effect.provideService(RuntimeContext, context))
    ),
};
