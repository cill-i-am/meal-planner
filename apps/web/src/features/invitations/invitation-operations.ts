import {
  InvitationReadApiClient,
  makeInvitationReadApiClientLayer,
} from "@meal-planner/household-api";
import type {
  InvitationId,
  InvitationView,
  UserId,
  SetupCheckpoint,
} from "@meal-planner/household-api";
import { Data, Effect } from "effect";
import { createEffectQuery } from "effect-query";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import type { makeAuthClient } from "../auth/auth-client.js";
import { requireAuthSuccess } from "../auth/auth-client.js";
import type { HouseholdPeopleEffectOperations } from "../household-people/operations.js";
import type { SetupContextValue } from "../onboarding/setup-context.js";

const effectQuery = createEffectQuery(FetchHttpClient.layer);

/** The query cache owns this recipient-scoped server view. */
export const invitationReadQueryOptions = (id: InvitationId, userId: UserId) =>
  effectQuery.queryOptions({
    queryFn: () =>
      InvitationReadApiClient.use((api) =>
        api.invitationRead.read({ params: { id } })
      ).pipe(
        Effect.provide(
          makeInvitationReadApiClientLayer({
            baseUrl: window.location.origin,
            headers: { "x-meal-planner-user": userId },
          })
        )
      ),
    queryKey: ["setup-invitation", userId, id],
    retry: false,
    staleTime: 0,
  });

export type InvitationCommand = Extract<
  SetupCheckpoint,
  { stage: "invitation-response" | "invitation-link" }
>;

export class InvitationOperationFailure extends Data.TaggedError(
  "InvitationOperationFailure"
)<{
  readonly reason:
    | "read"
    | "changed"
    | "response"
    | "closed"
    | "save"
    | "activate"
    | "link"
    | "logout";
  readonly cause?: unknown;
}> {}

const failure = (
  reason: InvitationOperationFailure["reason"],
  cause?: unknown
) => new InvitationOperationFailure({ cause, reason });

const fromPromise = <A>(
  reason: InvitationOperationFailure["reason"],
  operation: () => Promise<A>
) =>
  Effect.tryPromise({
    catch: (cause) => failure(reason, cause),
    try: operation,
  });

type SaveProgress = SetupContextValue["save"];

/** A saved response is reconciled before deciding whether to send it again. */
export const completeInvitation = (
  command: InvitationCommand,
  dependencies: {
    readonly auth: ReturnType<typeof makeAuthClient>;
    readonly read: () => Promise<InvitationView>;
    readonly activate: SetupContextValue["selectFamily"];
    readonly people: Pick<
      HouseholdPeopleEffectOperations,
      "list" | "completeAdultLink"
    >;
    readonly save: (next: SetupCheckpoint) => ReturnType<SaveProgress>;
  }
) =>
  Effect.gen(function* completeSavedInvitation() {
    const invitation = yield* fromPromise("read", dependencies.read);
    if (
      invitation.id !== command.invitationId ||
      invitation.organizationId !== command.organizationId
    ) {
      return yield* Effect.fail(failure("changed"));
    }
    if (
      command.stage === "invitation-response" &&
      command.decision === "decline"
    ) {
      if (invitation.status === "pending") {
        yield* fromPromise("response", () =>
          requireAuthSuccess(
            dependencies.auth.organization.rejectInvitation({
              invitationId: command.invitationId,
            })
          )
        );
      } else if (invitation.status !== "rejected") {
        return yield* Effect.fail(failure("closed"));
      }
      yield* dependencies
        .save(command.returnCheckpoint)
        .pipe(Effect.mapError((cause) => failure("save", cause)));
      return "declined" as const;
    }
    if (invitation.status === "pending") {
      yield* fromPromise("response", () =>
        requireAuthSuccess(
          dependencies.auth.organization.acceptInvitation({
            invitationId: command.invitationId,
          })
        )
      );
    } else if (invitation.status !== "accepted") {
      return yield* Effect.fail(failure("closed"));
    }
    const linking: InvitationCommand = {
      invitationId: command.invitationId,
      linkMutationId: command.linkMutationId,
      organizationId: command.organizationId,
      returnCheckpoint: command.returnCheckpoint,
      stage: "invitation-link",
    };
    yield* dependencies
      .save(linking)
      .pipe(Effect.mapError((cause) => failure("save", cause)));
    yield* dependencies
      .activate(command.organizationId)
      .pipe(Effect.mapError((cause) => failure("activate", cause)));
    const roster = yield* dependencies.people
      .list(false)
      .pipe(Effect.mapError((cause) => failure("link", cause)));
    if (roster.currentPersonId === null) {
      yield* dependencies.people
        .completeAdultLink({
          invitationId: command.invitationId,
          mutationId: command.linkMutationId,
        })
        .pipe(Effect.mapError((cause) => failure("link", cause)));
    }
    yield* dependencies
      .save({
        organizationId: command.organizationId,
        stage: "ready",
      })
      .pipe(Effect.mapError((cause) => failure("save", cause)));
    return "joined" as const;
  });

export const respondInvitationMutationOptions = (dependencies: {
  readonly activate: SetupContextValue["selectFamily"];
  readonly auth: SetupContextValue["auth"];
  readonly peopleEffectForFamily: SetupContextValue["peopleEffectForFamily"];
  readonly read: (id: InvitationId) => Promise<InvitationView>;
  readonly save: SaveProgress;
}) =>
  effectQuery.mutationOptions({
    mutationFn: (command: InvitationCommand) =>
      Effect.gen(function* respondInvitation() {
        yield* dependencies
          .save({ checkpoint: command, status: "active" })
          .pipe(Effect.mapError((cause) => failure("save", cause)));
        return yield* completeInvitation(command, {
          activate: dependencies.activate,
          auth: dependencies.auth,
          people: dependencies.peopleEffectForFamily(command.organizationId),
          read: () => dependencies.read(command.invitationId),
          save: (next) =>
            dependencies.save(
              { checkpoint: next, status: "active" },
              command.linkMutationId
            ),
        });
      }),
    mutationKey: ["respondInvitation"],
  });

export const pauseInvitationMutationOptions = (dependencies: {
  readonly save: SaveProgress;
}) =>
  effectQuery.mutationOptions({
    mutationFn: (command: InvitationCommand) =>
      dependencies
        .save({ checkpoint: command, status: "paused" })
        .pipe(Effect.mapError((cause) => failure("save", cause))),
    mutationKey: ["pauseInvitation"],
  });

export const logoutInvitationMutationOptions = (
  logout: SetupContextValue["logout"]
) =>
  effectQuery.mutationOptions({
    mutationFn: () =>
      logout().pipe(Effect.mapError((cause) => failure("logout", cause))),
    mutationKey: ["logoutInvitation"],
  });

export const recoverInvitationMutationOptions = (dependencies: {
  readonly pending: InvitationCommand | undefined;
  readonly save: SaveProgress;
}) =>
  effectQuery.mutationOptions({
    mutationFn: () =>
      Effect.gen(function* recoverInvitation() {
        if (dependencies.pending) {
          yield* dependencies
            .save(
              {
                checkpoint: dependencies.pending.returnCheckpoint,
                status: "active",
              },
              dependencies.pending.linkMutationId
            )
            .pipe(Effect.mapError((cause) => failure("save", cause)));
        }
      }),
    mutationKey: ["recoverInvitation"],
  });
