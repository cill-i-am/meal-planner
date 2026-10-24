import { HouseholdOrganizationId } from "@meal-planner/household-api";
import {
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportAction,
  RecipeImportActionId,
  RecipeImportIntent,
  RecipeImportIntentId,
  RecipeImportTimeline,
} from "@meal-planner/recipe-import-api";
import { hasTaskClientCapabilityV2 } from "@modelcontextprotocol/ext-tasks/core/v2";
import type {
  CancelTaskResultV2,
  CreateTaskResultV2,
  GetTaskResultV2,
  InputResponsesV2,
  UpdateTaskResultV2,
} from "@modelcontextprotocol/ext-tasks/core/v2";
import { inputRequired, ProtocolError } from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  InputRequiredResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { Clock, DateTime, Effect, Match, Option, Schema } from "effect";

import {
  prepareRecipeReview,
  projectImportPreparation,
} from "../imports/import-mcp.js";
import {
  ProductMcpReviewLifetimeMs,
  ProductMcpTaskLifetimeMs,
} from "./product-mcp-state.js";
import type { ProductMcpTaskLocator } from "./product-mcp-state.js";
import { callProductTool } from "./product-mcp-tools.js";
import type { ProductMcpDispatch } from "./product-mcp-tools.js";

const strict = { onExcessProperty: "error" } as const;
const IdempotencyHeaders = Schema.Struct({ "idempotency-key": IdempotencyKey });
const CreateArguments = Schema.Struct({
  familyId: HouseholdOrganizationId,
  headers: IdempotencyHeaders,
  input: CreateRecipeImportIntentRequest,
});
const ConfirmArguments = Schema.Struct({
  familyId: HouseholdOrganizationId,
  headers: IdempotencyHeaders,
  input: ConfirmRecipeImportActionRequest,
  path: Schema.Struct({
    actionId: RecipeImportActionId,
    id: RecipeImportIntentId,
  }),
});
const PublishResponses = Schema.Struct({
  publish: Schema.Union([
    Schema.Struct({
      action: Schema.Literal("accept"),
      content: Schema.Struct({ publish: Schema.Boolean }),
    }),
    Schema.Struct({
      action: Schema.Literals(["decline", "cancel"]),
      content: Schema.optionalKey(
        Schema.Record(
          Schema.String,
          Schema.Union([
            Schema.String,
            Schema.Number,
            Schema.Boolean,
            Schema.Array(Schema.String),
          ])
        )
      ),
    }),
  ]),
});
const ProductResponse = Schema.Struct({
  result: Schema.Json,
  retryAfter: Schema.NullOr(Schema.String),
});
const FormCapabilities = Schema.Struct({
  "io.modelcontextprotocol/clientCapabilities": Schema.Struct({
    elicitation: Schema.Struct({
      form: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
      url: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
    }),
  }),
});
const invalidInteraction = () =>
  new ProtocolError(
    -32_602,
    "Invalid, expired or inaccessible import interaction."
  );
const unavailableImport = () =>
  new ProtocolError(
    -32_603,
    "Import state is unavailable. Keep the original request identity and read its status before retrying."
  );
const messageResult = (message: string, isError = false): CallToolResult => ({
  content: [{ text: message, type: "text" }],
  isError,
});
const supportsForm = (context: ServerContext) => {
  const capabilities = Schema.decodeUnknownOption(FormCapabilities)(
    context.mcpReq.envelope
  );
  if (Option.isNone(capabilities)) {
    return false;
  }
  const { elicitation } =
    capabilities.value["io.modelcontextprotocol/clientCapabilities"];
  return elicitation.form !== undefined || elicitation.url === undefined;
};
const pollInterval = (retryAfter: string | null) => {
  const seconds = Number(retryAfter);
  return Number.isSafeInteger(seconds) && seconds > 0
    ? Math.max(5000, seconds * 1000)
    : 5000;
};

/** Projects existing import commands into MCP tasks and bounded review rounds. */
export const makeImportMcpInteraction = (options: {
  readonly request: Request;
  readonly dispatch: ProductMcpDispatch;
}) => {
  const { request, dispatch } = options;
  const call = (name: string, input: Schema.Json) =>
    callProductTool(name, input, request, dispatch);
  const read = (name: string, input: Schema.Json) =>
    call(name, input).pipe(
      Effect.flatMap((result) =>
        result.isError
          ? Effect.fail(invalidInteraction())
          : Schema.decodeUnknownEffect(ProductResponse)(
              result.structuredContent
            ).pipe(Effect.mapError(invalidInteraction))
      )
    );
  const readPreparation = (locator: ProductMcpTaskLocator) =>
    Effect.gen(function* readImportPreparation() {
      const args = {
        familyId: locator.familyId,
        path: { id: locator.intentId },
      };
      // Status and history are separate authorized reads. A workflow may advance
      // between them; reread at most twice without replaying any mutation.
      for (let attempt = 0; ; attempt += 1) {
        const response = yield* read("recipe_import_intents_get", args);
        const intent = yield* Schema.decodeUnknownEffect(RecipeImportIntent)(
          response.result
        );
        const history = yield* read("recipe_import_intents_timeline", args);
        const timeline = yield* Schema.decodeUnknownEffect(
          RecipeImportTimeline
        )(history.result);
        if (intent.id !== locator.intentId) {
          return yield* Effect.fail(unavailableImport());
        }
        if (timeline.data.length > intent.intentVersion && attempt < 2) {
          continue;
        }
        return {
          projection: projectImportPreparation(intent, timeline),
          retryAfter: response.retryAfter,
        };
      }
    }).pipe(Effect.mapError(unavailableImport));
  const task = (
    taskId: string
  ): Effect.Effect<GetTaskResultV2, ProtocolError> =>
    Effect.gen(function* getImportTask() {
      const locator = yield* dispatch.state
        .readTask(taskId)
        .pipe(Effect.mapError(invalidInteraction));
      const { projection, retryAfter } = yield* readPreparation(locator);
      const common = {
        createdAt: new Date(locator.createdAt).toISOString(),
        resultType: "complete" as const,
        taskId,
        ttlMs: ProductMcpTaskLifetimeMs,
      };
      return yield* Match.value(projection).pipe(
        Match.tagsExhaustive({
          Cancelled: ({ completedAt }) =>
            Effect.succeed<GetTaskResultV2>({
              ...common,
              lastUpdatedAt: DateTime.formatIso(completedAt),
              status: "cancelled",
            }),
          Completed: ({ completedAt, isError, result }) =>
            Effect.succeed<GetTaskResultV2>({
              ...common,
              lastUpdatedAt: DateTime.formatIso(completedAt),
              result: {
                content: [{ text: JSON.stringify(result), type: "text" }],
                isError,
                structuredContent: result,
              },
              status: "completed",
            }),
          Unavailable: () => Effect.fail(unavailableImport()),
          Working: ({ intent }) =>
            Effect.succeed<GetTaskResultV2>({
              ...common,
              lastUpdatedAt: DateTime.formatIso(intent.updatedAt),
              pollIntervalMs: pollInterval(retryAfter),
              status: "working",
              statusMessage: "Preparing a recipe draft.",
            }),
        })
      );
    });
  const create = (
    input: Schema.Json
  ): Effect.Effect<CallToolResult | CreateTaskResultV2, ProtocolError> =>
    Effect.gen(function* createImportTask() {
      const args = yield* Schema.decodeUnknownEffect(CreateArguments)(
        input,
        strict
      ).pipe(Effect.mapError(invalidInteraction));
      const result = yield* call("recipe_import_intents_create", input);
      if (result.isError) {
        return result;
      }
      const response = yield* Schema.decodeUnknownEffect(ProductResponse)(
        result.structuredContent
      ).pipe(Effect.mapError(unavailableImport));
      const intent = yield* Schema.decodeUnknownEffect(RecipeImportIntent)(
        response.result
      ).pipe(Effect.mapError(unavailableImport));
      const taskId = yield* dispatch.state
        .issueTask({
          createdAt: DateTime.toEpochMillis(intent.createdAt),
          familyId: args.familyId,
          intentId: intent.id,
        })
        .pipe(Effect.mapError(unavailableImport));
      const current = yield* task(taskId);
      return {
        createdAt: current.createdAt,
        lastUpdatedAt: current.lastUpdatedAt,
        pollIntervalMs: current.pollIntervalMs,
        resultType: "task",
        status: current.status,
        taskId,
        ttlMs: current.ttlMs,
      };
    });
  const review = (
    input: Schema.Json,
    context: ServerContext
  ): Effect.Effect<CallToolResult | InputRequiredResult, ProtocolError> =>
    Effect.gen(function* reviewImportPublication() {
      const args = yield* Schema.decodeUnknownEffect(ConfirmArguments)(
        input,
        strict
      ).pipe(Effect.mapError(invalidInteraction));
      const rawState = context.mcpReq.requestState<unknown>();
      if ((context.mcpReq.droppedInputResponseKeys?.length ?? 0) > 0) {
        return yield* Effect.fail(invalidInteraction());
      }
      if (
        rawState !== undefined ||
        context.mcpReq.inputResponses !== undefined
      ) {
        const token = yield* Schema.decodeUnknownEffect(Schema.String)(
          rawState
        ).pipe(Effect.mapError(invalidInteraction));
        const state = yield* dispatch.state
          .readReview(token)
          .pipe(Effect.mapError(invalidInteraction));
        if (
          state.familyId !== args.familyId ||
          state.intentId !== args.path.id ||
          state.actionId !== args.path.actionId ||
          state.actionVersion !== args.input.expectedActionVersion ||
          state.idempotencyKey !== args.headers["idempotency-key"]
        ) {
          return yield* Effect.fail(invalidInteraction());
        }
        const { publish } = yield* Schema.decodeUnknownEffect(PublishResponses)(
          context.mcpReq.inputResponses,
          strict
        ).pipe(Effect.mapError(invalidInteraction));
        if (publish.action === "accept" && publish.content.publish) {
          // The domain mutation receipt owns accepted replay and exact-version conflicts.
          return yield* call("recipe_import_intents_confirm_action", input);
        }
        yield* read("recipe_import_intents_get", {
          familyId: args.familyId,
          path: { id: args.path.id },
        });
        return messageResult(
          "Publication was not requested. The draft was left unchanged."
        );
      }
      const response = yield* read("recipe_import_intents_get_action", {
        familyId: args.familyId,
        path: args.path,
      });
      const action = yield* Schema.decodeUnknownEffect(RecipeImportAction)(
        response.result
      ).pipe(Effect.mapError(unavailableImport));
      if (
        action.id !== args.path.actionId ||
        action.intentId !== args.path.id
      ) {
        return yield* Effect.fail(unavailableImport());
      }
      const prepared = prepareRecipeReview(
        action,
        args.input.expectedActionVersion
      );
      if (prepared._tag === "Unavailable") {
        return messageResult(prepared.message, true);
      }
      const now = yield* Clock.currentTimeMillis;
      const state = yield* dispatch.state
        .issueReview({
          actionId: prepared.actionId,
          actionVersion: prepared.actionVersion,
          expiresAt: now + ProductMcpReviewLifetimeMs,
          familyId: args.familyId,
          idempotencyKey: args.headers["idempotency-key"],
          intentId: prepared.intentId,
        })
        .pipe(Effect.mapError(unavailableImport));
      return inputRequired({
        inputRequests: {
          publish: inputRequired.elicit({
            message: prepared.message,
            mode: "form",
            requestedSchema: {
              properties: {
                publish: {
                  title: "Publish this reviewed recipe?",
                  type: "boolean",
                },
              },
              required: ["publish"],
              type: "object",
            },
          }),
        },
        requestState: state,
      });
    });
  return {
    call: (
      name: string,
      input: Schema.Json,
      context: ServerContext
    ): Effect.Effect<
      CallToolResult | InputRequiredResult | CreateTaskResultV2,
      ProtocolError
    > => {
      const continuing =
        context.mcpReq.requestState<unknown>() !== undefined ||
        context.mcpReq.inputResponses !== undefined ||
        (context.mcpReq.droppedInputResponseKeys?.length ?? 0) > 0;
      if (
        name === "recipe_import_intents_confirm_action" &&
        (continuing ||
          (supportsForm(context) &&
            dispatch.permits(["meal-planner:read", "meal-planner:write"])))
      ) {
        return review(input, context);
      }
      if (continuing) {
        return Effect.fail(invalidInteraction());
      }
      if (
        name === "recipe_import_intents_create" &&
        hasTaskClientCapabilityV2({ _meta: context.mcpReq.envelope }) &&
        dispatch.permits(["meal-planner:read", "meal-planner:write"])
      ) {
        return create(input);
      }
      return call(name, input);
    },
    cancel: (
      taskId: string
    ): Effect.Effect<CancelTaskResultV2, ProtocolError> =>
      Effect.gen(function* cancelImportTask() {
        const locator = yield* dispatch.state
          .readTask(taskId)
          .pipe(Effect.mapError(invalidInteraction));
        const { projection } = yield* readPreparation(locator);
        if (projection._tag === "Unavailable") {
          return yield* Effect.fail(unavailableImport());
        }
        if (projection._tag === "Working") {
          const result = yield* call("recipe_import_intents_cancel", {
            familyId: locator.familyId,
            headers: {
              "idempotency-key": `mcp-task-cancel:${locator.intentId}`,
            },
            input: { expectedIntentVersion: projection.intent.intentVersion },
            path: { id: locator.intentId },
          });
          if (result.isError) {
            return yield* Effect.fail(unavailableImport());
          }
        }
        return { resultType: "complete" };
      }),
    get: task,
    update: (
      taskId: string,
      _inputResponses: InputResponsesV2
    ): Effect.Effect<UpdateTaskResultV2, ProtocolError> =>
      Effect.gen(function* acknowledgeImportTaskUpdate() {
        const locator = yield* dispatch.state
          .readTask(taskId)
          .pipe(Effect.mapError(invalidInteraction));
        // Preparation tasks never await input; unknown and satisfied responses are no-ops.
        yield* read("recipe_import_intents_get", {
          familyId: locator.familyId,
          path: { id: locator.intentId },
        });
        return { resultType: "complete" };
      }),
  };
};
