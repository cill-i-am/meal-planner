import {
  ConversationConflict,
  ConversationForbidden,
  ConversationUnavailable,
} from "@meal-planner/agent-conversations-api";
import {
  InterviewProfileOutcome,
  PersonProfile,
} from "@meal-planner/household-api";
import { DirectoryFrame } from "@meal-planner/private-interview-api";
import type { DirectoryCommand } from "@meal-planner/private-interview-api";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { makeAgentConversationHost } from "../../agent-conversations.js";
import type { AgentConversationHostOptions } from "../../agent-conversations.js";
import { JsonHttpPlatformServices } from "../../infrastructure/json-http-platform.js";
import { authorizeApplicationRequest } from "../auth/application-access.js";
import { ReleasedConfirmation } from "../private-output/private-confirmation.contract.js";
import type { PrivateOutputApiPort } from "../private-output/private-output-binding.js";
import { resolvePrivateOutputAuthority } from "../private-output/private-output.authority.js";
import {
  PrivateCommandResult,
  ProductConversationsApi,
} from "./product-conversations.contract.js";

const unavailable = () =>
  ConversationUnavailable.make({
    code: "conversation_unavailable",
    message:
      "The result could not be confirmed. Read the session or retry the same request identity.",
    status: 503,
  });
const forbidden = () =>
  ConversationForbidden.make({
    code: "conversation_forbidden",
    message: "This private conversation is unavailable to your account.",
    status: 403,
  });
const PrivateRequestFailure = Schema.Struct({
  reason: Schema.Literals([
    "authority_unavailable",
    "binding_conflict",
    "operation_conflict",
    "output_disabled",
  ]),
});
const call = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (error) => {
      const parsed = Schema.decodeUnknownOption(PrivateRequestFailure)(error);
      if (Option.isNone(parsed)) {
        return unavailable();
      }
      if (parsed.value.reason === "operation_conflict") {
        return ConversationConflict.make({
          code: "conversation_conflict",
          message:
            "The session changed or this request identity was reused. Read its current state before continuing.",
          status: 409,
        });
      }
      return forbidden();
    },
    try: operation,
  });
const firstPage = { afterCardOrdinal: 0, afterMessageOrdinal: 0, limit: 25 };

/** Native durable owners retain receipts and model lifetimes; this layer only admits requests. */
export const makeProductConversationsHttpLayer = (options: {
  readonly conversation: AgentConversationHostOptions;
  readonly output: PrivateOutputApiPort;
}) => {
  const { auth, domain: household } = options.conversation;
  const { output } = options;
  const conversation = makeAgentConversationHost(options.conversation);
  const authorize = (sessionReference?: string) =>
    Effect.gen(function* admitPrivateApiRequest() {
      yield* authorizeApplicationRequest(auth).pipe(Effect.mapError(forbidden));
      const request = yield* HttpServerRequest.HttpServerRequest;
      const headers = new Headers(Object.entries(request.headers));
      const resolve = () =>
        resolvePrivateOutputAuthority({ auth, headers, household }).pipe(
          Effect.mapError(forbidden)
        );
      const initial = yield* resolve();
      const participant = {
        accountKey: initial.accountKey,
        householdKey: initial.householdKey,
        linkageSubject: initial.linkageSubject,
        personId: initial.personId,
      };
      const generation = yield* call(() =>
        sessionReference === undefined
          ? output.beginDirectoryRequest(participant)
          : output.beginRequest({ ...participant, sessionReference })
      );
      // Register both lifecycle fences before the final canonical membership read.
      const current = yield* resolve();
      const { expiresAt } = current;
      const binding = {
        accountKey: current.accountKey,
        householdKey: current.householdKey,
        linkageSubject: current.linkageSubject,
        personId: current.personId,
      };
      yield* call(() =>
        sessionReference === undefined
          ? output.authorizeDirectoryRequest({ binding, expiresAt, generation })
          : output.authorizeRequest({
              binding: { ...binding, sessionReference },
              expiresAt,
              generation,
            })
      );
      return { binding, current, generation };
    });
  const directory = (command: DirectoryCommand) =>
    Effect.gen(function* executePrivateDirectoryCommand() {
      const { binding, generation } = yield* authorize();
      return yield* call(() =>
        output.executeDirectory({ binding, command, generation })
      );
    });
  const session = (sessionReference: string) =>
    authorize(sessionReference).pipe(
      Effect.map((admitted) => ({
        ...admitted,
        binding: { ...admitted.binding, sessionReference },
      }))
    );
  return HttpApiBuilder.layer(ProductConversationsApi).pipe(
    Layer.provide(
      HttpApiBuilder.group(
        ProductConversationsApi,
        "conversationTurns",
        (handlers) =>
          handlers
            .handle("setup", ({ payload }) => conversation.submit(payload))
            .handle("family", ({ params, payload }) =>
              conversation.submit(payload, params.familyId)
            )
      )
    ),
    Layer.provide(
      HttpApiBuilder.group(
        ProductConversationsApi,
        "privateInterviews",
        (handlers) =>
          handlers
            .handle("list", ({ query }) =>
              directory({
                afterOrdinal: query.afterOrdinal ?? 0,
                limit: query.limit ?? 25,
                requestId: crypto.randomUUID(),
                type: "ListSessions",
              }).pipe(
                Effect.flatMap((frame) =>
                  Schema.decodeUnknownEffect(DirectoryFrame.members[2])(
                    frame
                  ).pipe(Effect.mapError(unavailable))
                )
              )
            )
            .handle("start", ({ payload }) =>
              directory(payload).pipe(
                Effect.flatMap((frame) =>
                  Schema.decodeUnknownEffect(
                    Schema.Union([
                      DirectoryFrame.members[1],
                      DirectoryFrame.members[3],
                    ])
                  )(frame).pipe(Effect.mapError(unavailable))
                )
              )
            )
            .handle("read", ({ params, query }) =>
              Effect.gen(function* readPrivateSession() {
                const { binding, generation } = yield* session(
                  params.sessionReference
                );
                return yield* call(() =>
                  output.readSession({
                    afterCardOrdinal: query.afterCardOrdinal ?? 0,
                    afterMessageOrdinal: query.afterMessageOrdinal ?? 0,
                    binding,
                    generation,
                    limit: query.limit ?? 25,
                  })
                );
              })
            )
            .handle("command", ({ params, payload }) =>
              Effect.gen(function* commandPrivateSession() {
                const { binding, generation } = yield* session(
                  params.sessionReference
                );
                return yield* call(() =>
                  output.executeSession({
                    binding,
                    command: payload,
                    generation,
                  })
                ).pipe(
                  Effect.flatMap((frame) =>
                    Schema.decodeUnknownEffect(PrivateCommandResult)(
                      frame
                    ).pipe(Effect.mapError(unavailable))
                  )
                );
              })
            )
            .handle("startTurn", ({ params, payload }) =>
              Effect.gen(function* startPrivateTurn() {
                const { binding, current, generation } = yield* session(
                  params.sessionReference
                );
                const profile = yield* household
                  .readPersonProfile({
                    admission: current.admission,
                    personId: current.personId,
                    version: null,
                  })
                  .pipe(
                    Effect.flatMap(Schema.decodeUnknownEffect(PersonProfile)),
                    Effect.mapError(unavailable)
                  );
                return yield* call(() =>
                  output.startTurn({ ...payload, binding, generation, profile })
                );
              })
            )
            .handle("cancelTurn", ({ params }) =>
              Effect.gen(function* cancelPrivateTurn() {
                const { binding, generation } = yield* session(
                  params.sessionReference
                );
                return yield* call(() =>
                  output.cancelTurn({
                    binding,
                    generation,
                    turnId: params.turnId,
                  })
                );
              })
            )
            .handle("continueConfirmation", ({ params }) =>
              Effect.gen(function* continuePrivateConfirmation() {
                const { binding, current, generation } = yield* session(
                  params.sessionReference
                );
                const released = yield* call(() =>
                  output.releaseConfirmation({
                    binding,
                    generation,
                    mutationId: params.mutationId,
                  })
                ).pipe(
                  Effect.flatMap((result) =>
                    Schema.decodeUnknownEffect(ReleasedConfirmation)(
                      result
                    ).pipe(Effect.mapError(unavailable))
                  )
                );
                if (released.type === "pending") {
                  const outcome = yield* household
                    .mutateInterviewProfile({
                      admission: current.admission,
                      payload: released.payload,
                      personId: current.personId,
                    })
                    .pipe(
                      Effect.flatMap(
                        Schema.decodeUnknownEffect(InterviewProfileOutcome)
                      ),
                      Effect.mapError(unavailable)
                    );
                  yield* call(() =>
                    output.settleConfirmation({
                      binding,
                      generation: released.generation,
                      mutationId: params.mutationId,
                      outcome,
                    })
                  );
                }
                return yield* call(() =>
                  output.readSession({ ...firstPage, binding, generation })
                );
              })
            )
      )
    ),
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(
      HttpRouter.middleware((effect) =>
        effect.pipe(
          Effect.map(HttpServerResponse.setHeader("cache-control", "no-store"))
        )
      ).layer
    )
  );
};
