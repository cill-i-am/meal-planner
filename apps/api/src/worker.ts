import { EmailAddress } from "@meal-planner/household-api";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { Config, Layer, Schema, Stream } from "effect";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import {
  handleAgentConversationChatRequest,
  makeAgentConversationHttpLayer,
} from "./agent-conversations.js";
import { makeAuthFamilyHttpLayer } from "./auth-family.js";
import { agentConversationBindings } from "./features/agent-conversations/conversation-binding.js";
import { renderPasswordResetMail } from "./features/auth/auth-mail.js";
import { makeAlchemyMealPlannerAuth } from "./features/auth/auth.alchemy.js";
import * as authSchema from "./features/auth/auth.database-schema.js";
import {
  makeAuthenticatedOrganizationResolver,
  makeAuthPrincipalResolver,
} from "./features/auth/auth.principal.js";
import { makeCloudflareEmailSender } from "./features/email/index.js";
import { HealthRoutes } from "./features/health/health.routes.js";
import { HouseholdDomainWorker } from "./features/households/household-domain-worker.js";
import {
  makeHouseholdDomainGateway,
  makeHouseholdMealPlanGateway,
  makeHouseholdMealPlanRequestLayer,
  makeHouseholdPlanningContentGateway,
  makeHouseholdPlanningContentRequestLayer,
  makeHouseholdInvitationRecipientVerifier,
  makeHouseholdRequestLayer,
} from "./features/households/household-request-composition.js";
import { makeHouseholdInvitationMailer } from "./features/households/people/invitation-mail.adapter.js";
import { makeMemberDepartureWorkflowStarter } from "./features/households/people/member-departure.js";
import MemberDepartureWorkflow from "./features/households/people/member-departure.workflow.js";
import HouseholdImportBatchItemWorkflow from "./features/imports/household-import-batch-item.workflow.js";
import {
  handleHouseholdImportBatchDeadLetterMessage,
  handleHouseholdImportBatchQueueMessage,
  makeHouseholdBatchWorkflowLauncher,
} from "./features/imports/household-import-batch-queue.handlers.js";
import {
  makeRecipeImportHttpApiLayer,
  makeRecipeImportNotFoundHttpLayer,
} from "./features/imports/import-intent-api.http.js";
import { makeImportTraceContext } from "./features/imports/import-observability.js";
import { ProviderRecoveryRouteDefinitions } from "./features/imports/import-provider-recovery.routes.js";
import { makeRecipeRecoveryWorkflowStarter } from "./features/imports/import-recipe-recovery.js";
import ImportRecipeRecoveryWorkflow from "./features/imports/import-recipe-recovery.workflow.js";
import {
  HouseholdScopeId,
  ImportActorId,
  ImportPrincipal,
} from "./features/imports/import-system-principal.js";
import { makeImportWorkerRequestLayer } from "./features/imports/import-worker-request-layer.js";
import { ImportSystemAuthorizationConfig } from "./features/imports/import.auth.config.js";
import ImportAcquisitionWorkflow, {
  makeImportWorkflowStarter,
} from "./features/imports/import.workflow.js";
import {
  PrivateOutputApiBinding,
  PrivateOutputMutationsBinding,
  privateOutputApiPort,
  privateOutputMutationPort,
} from "./features/private-output/private-output-binding.js";
import { makeAuthOutputFence } from "./features/private-output/private-output-mutation.js";
import { handlePrivateInterviewRequest } from "./features/private-output/private-output.http.js";
import { ProviderAccountingRouteDefinitions } from "./features/provider-accounting/provider-accounting.routes.js";
import {
  HouseholdImportBatchDeadLetterQueue,
  HouseholdImportBatchQueue,
} from "./infrastructure/household-import-batch-queue.js";
import { MealPlannerAuthDatabase } from "./infrastructure/meal-planner-auth-database.js";
import { ProviderAccountingDatabase } from "./infrastructure/provider-accounting-database.js";
import { withCurrentRequestCancellation } from "./infrastructure/request-cancellation.js";

const MealPlannerOperationalRoutes = [
  ...HealthRoutes,
  ...ProviderAccountingRouteDefinitions,
  ...ProviderRecoveryRouteDefinitions,
] as const;

const currentIsoTimestamp = () => new Date().toISOString();

/** Effect-native Cloudflare host for health and authenticated import routes. */
export default class MealPlannerApi extends Cloudflare.Worker<MealPlannerApi>()(
  "MealPlannerApi",
  Effect.gen(function* MealPlannerApiProps() {
    const conversationBindings = yield* agentConversationBindings;
    return {
      build: { nativeExports: ["AgentConversation"] },
      env: {
        ...conversationBindings,
        PrivateOutputApi: PrivateOutputApiBinding,
        PrivateOutputMutations: PrivateOutputMutationsBinding,
      },
      main: globalThis.__ALCHEMY_RUNTIME__
        ? "worker-entry.ts"
        : new URL("worker-entry.ts", import.meta.url).href,
      observability: {
        enabled: true,
        headSamplingRate: 1,
        logs: {
          enabled: true,
          headSamplingRate: 1,
          // Invocation logs include request/response metadata and fetch URLs.
          // Emit only the application's closed, allowlisted event contract.
          invocationLogs: false,
          persist: true,
        },
        traces: {
          // Automatic Worker tracing records url.full/url.path/url.query.
          // Closed Effect events remain in application logs.
          enabled: false,
        },
      },
      workersDev: false,
    };
  }),
  Effect.gen(function* MealPlannerApiWorker() {
    const providerAccountingQueryDatabase = yield* Cloudflare.D1.QueryDatabase(
      ProviderAccountingDatabase
    );
    const authQueryDatabase = yield* Cloudflare.D1.QueryDatabase(
      MealPlannerAuthDatabase
    );
    const importAcquisitionWorkflow = yield* ImportAcquisitionWorkflow;
    const importRecipeRecoveryWorkflow = yield* ImportRecipeRecoveryWorkflow;
    const memberDepartureWorkflow = yield* MemberDepartureWorkflow;
    const householdBatchItemWorkflow = yield* HouseholdImportBatchItemWorkflow;
    const householdBatchQueue = yield* HouseholdImportBatchQueue;
    const householdBatchDeadLetterQueue =
      yield* HouseholdImportBatchDeadLetterQueue;
    const householdDomain = yield* Cloudflare.Workers.bindWorker(
      HouseholdDomainWorker
    );
    const workerEnvironment = yield* Cloudflare.Workers.WorkerEnvironment;
    const conversations = workerEnvironment["AgentConversation"];
    const emailSenderAddress = Schema.decodeUnknownSync(EmailAddress)(
      yield* Config.string("MEAL_PLANNER_EMAIL_SENDER_ADDRESS").pipe(
        Config.withDefault("noreply@mail.ceird.app")
      )
    );
    const emailBinding = yield* Cloudflare.Email.SendEmail(
      "MealPlannerTransactionalEmail",
      { allowedSenderAddresses: [emailSenderAddress] }
    );
    const emailClient = yield* Cloudflare.Email.Send(emailBinding);
    const emailDeliveryEnabled = yield* Config.boolean(
      "MEAL_PLANNER_EMAIL_DELIVERY_ENABLED"
    ).pipe(Config.withDefault(false));
    const householdBatchWorkflowLauncher = makeHouseholdBatchWorkflowLauncher(
      householdBatchItemWorkflow
    );
    const authSecret = yield* Config.redacted("BETTER_AUTH_SECRET");
    const importSystemApiToken = yield* ImportSystemAuthorizationConfig.pipe(
      Effect.orDie
    );
    const importSystemActorId = Schema.decodeUnknownSync(ImportActorId)(
      yield* Config.string("MEAL_PLANNER_IMPORT_ACTOR_ID")
    );
    const importSystemHouseholdScopeId = Schema.decodeUnknownSync(
      HouseholdScopeId
    )(yield* Config.string("MEAL_PLANNER_IMPORT_HOUSEHOLD_SCOPE_ID"));
    const importSystemPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
      actorId: importSystemActorId,
      householdScopeId: importSystemHouseholdScopeId,
    });
    yield* Cloudflare.Queues.consumeQueueMessages(
      householdBatchQueue,
      {
        batchSize: 1,
        deadLetterQueue: householdBatchDeadLetterQueue.queueName,
        deadLetterQueueId: householdBatchDeadLetterQueue.queueId,
        maxConcurrency: 4,
        maxRetries: 3,
      },
      (messages) =>
        Stream.runForEach(messages, ({ body }) =>
          handleHouseholdImportBatchQueueMessage(
            body,
            householdBatchWorkflowLauncher
          ).pipe(Effect.asVoid)
        )
    );
    yield* Cloudflare.Queues.consumeQueueMessages(
      householdBatchDeadLetterQueue,
      { batchSize: 1, maxConcurrency: 1 },
      (messages) =>
        Stream.runForEach(messages, ({ body }) =>
          handleHouseholdImportBatchDeadLetterMessage(
            body,
            householdDomain,
            householdBatchWorkflowLauncher
          ).pipe(Effect.asVoid)
        )
    );
    return {
      fetch: Effect.gen(function* handleMealPlannerRequest() {
        const runtimeContext = yield* RuntimeContext;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = request.source;
        if (!(webRequest instanceof Request)) {
          return yield* Effect.die("Expected a Web Request source.");
        }
        const providerAccountingDatabase =
          yield* providerAccountingQueryDatabase.raw;
        const authDatabase = drizzle(yield* authQueryDatabase.raw);
        const requestOrigin = new URL(webRequest.url).origin;
        const outputApi = yield* privateOutputApiPort;
        const outputMutations = yield* privateOutputMutationPort;
        const outputFence = makeAuthOutputFence(outputMutations);
        const sendEmail = makeCloudflareEmailSender(
          emailClient,
          runtimeContext,
          emailDeliveryEnabled,
          emailSenderAddress
        );
        const auth = yield* makeAlchemyMealPlannerAuth({
          baseURL: requestOrigin,
          database: authDatabase,
          outputFence,
          schema: authSchema,
          secret: authSecret,
          sendPasswordResetEmail: async (mail) =>
            sendEmail(await renderPasswordResetMail(mail)),
          verifyInvitationRecipient:
            makeHouseholdInvitationRecipientVerifier(householdDomain),
        });
        if (new URL(webRequest.url).pathname.startsWith("/api/auth/")) {
          return yield* auth.fetchHttpEffect(webRequest);
        }
        const authenticatedOrganizationResolver =
          makeAuthenticatedOrganizationResolver({ auth });
        const sendInvitationEmail = makeHouseholdInvitationMailer({
          baseURL: requestOrigin,
          database: authDatabase,
          send: sendEmail,
        });
        const departureWorkflow = makeMemberDepartureWorkflowStarter(
          memberDepartureWorkflow
        );
        const agentConversationOptions = {
          auth,
          conversations,
          database: authDatabase,
          departureWorkflow,
          domain: householdDomain,
          headers: webRequest.headers,
          resolver: authenticatedOrganizationResolver,
          sendInvitationEmail,
        };
        const agentChat = yield* handleAgentConversationChatRequest({
          ...agentConversationOptions,
          request: webRequest,
        });
        if (agentChat !== null) {
          return HttpServerResponse.raw(agentChat, {
            status: agentChat.status,
          });
        }
        const privateInterview = yield* handlePrivateInterviewRequest({
          auth,
          household: householdDomain,
          output: outputApi,
          request: webRequest,
        });
        if (privateInterview !== null) {
          // Public raw-response interop preserves the native 101 WebSocket without rebuilding it.
          return HttpServerResponse.raw(privateInterview, {
            status: privateInterview.status,
          });
        }
        const trace = makeImportTraceContext();
        const requestServices = makeImportWorkerRequestLayer({
          householdDomain,
          importWorkflowStarter: makeImportWorkflowStarter(
            importAcquisitionWorkflow
          ),
          now: currentIsoTimestamp,
          organizationResolver: authenticatedOrganizationResolver,
          principalResolver: makeAuthPrincipalResolver({
            auth,
          }),
          providerAccountingDatabase,
          recipeRecoveryStarter: makeRecipeRecoveryWorkflowStarter(
            importRecipeRecoveryWorkflow
          ),
          runtimeContext,
          systemApiToken: importSystemApiToken,
          systemPrincipal: importSystemPrincipal,
          trace,
        });
        const householdRequestLayer = makeHouseholdRequestLayer({
          gateway: makeHouseholdDomainGateway(householdDomain),
          resolver: authenticatedOrganizationResolver,
        });
        const householdMealPlanRequestLayer = makeHouseholdMealPlanRequestLayer(
          {
            gateway: makeHouseholdMealPlanGateway({
              domain: householdDomain,
            }),
            resolver: authenticatedOrganizationResolver,
          }
        );
        const householdPlanningContentRequestLayer =
          makeHouseholdPlanningContentRequestLayer({
            gateway: makeHouseholdPlanningContentGateway({
              domain: householdDomain,
            }),
            resolver: authenticatedOrganizationResolver,
          });
        const authFamilyRoutes = makeAuthFamilyHttpLayer({
          auth,
          database: authDatabase,
          departureWorkflow,
          domain: householdDomain,
          headers: webRequest.headers,
          resolver: authenticatedOrganizationResolver,
          sendInvitationEmail,
        });
        const routeHandler = yield* HttpRouter.toHttpEffect(
          Layer.mergeAll(
            HttpRouter.addAll(MealPlannerOperationalRoutes),
            authFamilyRoutes,
            makeRecipeImportHttpApiLayer(),
            householdRequestLayer,
            householdMealPlanRequestLayer,
            householdPlanningContentRequestLayer,
            makeAgentConversationHttpLayer(agentConversationOptions),
            makeRecipeImportNotFoundHttpLayer()
          ).pipe(
            Layer.provide(requestServices),
            HttpRouter.provideRequest(requestServices)
          )
        );
        return yield* withCurrentRequestCancellation(routeHandler);
      }),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.Email.SendBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        Cloudflare.Queues.EventSourceLive,
        Cloudflare.Queues.WriteQueueBinding
      )
    )
  )
) {}
