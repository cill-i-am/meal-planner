import { failure } from "@meal-planner/sigen";
import type { SigenFailure, StationId } from "@meal-planner/sigen";
import type { SigenClient } from "@meal-planner/sigen/client";
import type {
  ApproveCommandInput,
  CommandInput,
  PrepareCommandInput,
  RevokeApprovalInput,
} from "@meal-planner/sigen/controls";
import {
  ApprovalGrant,
  Command,
  controlMatches,
  snapshotConfiguration,
} from "@meal-planner/sigen/controls";
import { Clock, Effect, Schema, absurd } from "effect";
import type { Redacted } from "effect";

export const CommandBook = Schema.Struct({
  commands: Schema.Array(Command).check(Schema.isMaxLength(256)),
  connectionId: Schema.String,
  grants: Schema.Array(ApprovalGrant).check(Schema.isMaxLength(32)),
});
export type CommandBook = typeof CommandBook.Type;
export interface CommandStorage<R> {
  readonly read: Effect.Effect<CommandBook | null, SigenFailure, R>;
  readonly write: (book: CommandBook) => Effect.Effect<void, SigenFailure, R>;
}
export interface CommandConnection<R> {
  readonly run: <A>(
    stationId: StationId,
    operation: (
      token: Redacted.Redacted<string>,
      connectionId: string
    ) => Effect.Effect<A, SigenFailure, R>
  ) => Effect.Effect<A, SigenFailure, R>;
}
const fingerprint = (value: Omit<Command["review"], "reviewFingerprint">) =>
  Effect.tryPromise({
    catch: () => failure("StorageUnavailable"),
    try: async () => {
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value))
      );
      return [...new Uint8Array(bytes)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    },
  });

/** All operations run under the account session lock. A saved dispatch marker is never replayed. */
export const makeCommands = <R>(
  storage: CommandStorage<R>,
  connection: CommandConnection<R>,
  client: Pick<
    SigenClient,
    "inspectControl" | "validateControl" | "dispatchControl"
  >,
  enabled: boolean
) => {
  const bookFor = (connectionId: string) =>
    storage.read.pipe(
      Effect.map((book): CommandBook =>
        book?.connectionId === connectionId
          ? book
          : {
              commands: (book?.commands ?? []).map((command): Command =>
                command.phase.status === "prepared" ||
                command.phase.status === "approved"
                  ? {
                      ...command,
                      phase: {
                        reason: "AuthenticationRequired",
                        status: "rejected",
                      },
                    }
                  : command
              ),
              connectionId,
              grants: [],
            }
      )
    );
  const find = (book: CommandBook, input: typeof CommandInput.Type) => {
    const command = book.commands.find(
      (item) =>
        item.review.commandId === input.commandId &&
        item.review.stationId === input.stationId
    );
    return command === undefined
      ? Effect.fail(failure("InvalidInput"))
      : Effect.succeed(command);
  };
  const save = (book: CommandBook, command: Command) =>
    storage
      .write({
        ...book,
        commands: book.commands.map((item) =>
          item.review.commandId === command.review.commandId ? command : item
        ),
      })
      .pipe(Effect.as(command));
  const activeGrant = (book: CommandBook, command: Command) =>
    book.grants.find(
      (grant) =>
        grant.scope.stationId === command.review.stationId &&
        grant.scope.operation === command.review.change.operation
    );
  const reconcile = (
    book: CommandBook,
    command: Command,
    attemptedAt: number,
    token: Redacted.Redacted<string>
  ) =>
    Effect.gen(function* reconcileCommand() {
      const result = yield* client
        .inspectControl(command.review.stationId, command.review.change, token)
        .pipe(Effect.result);
      if (result._tag === "Failure") {
        return yield* save(book, {
          ...command,
          phase: {
            attemptedAt,
            reason: result.failure.reason,
            status: "outcome_unknown",
          },
        });
      }
      return yield* save(book, {
        ...command,
        phase: controlMatches(command.review.change, result.success)
          ? {
              attemptedAt,
              observed: result.success,
              observedAt: yield* Clock.currentTimeMillis,
              status: "verified",
            }
          : {
              attemptedAt,
              reason: "CommandOutcomeUnknown",
              status: "outcome_unknown",
            },
      });
    });
  return {
    approvalGrants: (stationId: StationId) =>
      connection.run(stationId, (_token, connectionId) =>
        bookFor(connectionId).pipe(
          Effect.map((book) => ({
            grants: book.grants.filter(
              (grant) => grant.scope.stationId === stationId
            ),
          }))
        )
      ),
    approveCommand: (input: typeof ApproveCommandInput.Type) =>
      connection.run(input.stationId, (_token, connectionId) =>
        Effect.gen(function* approveCommand() {
          const book = yield* bookFor(connectionId);
          const command = yield* find(book, input);
          const now = yield* Clock.currentTimeMillis;
          if (
            command.review.reviewFingerprint !== input.reviewFingerprint ||
            JSON.stringify(command.review.change) !==
              JSON.stringify(input.change) ||
            JSON.stringify(command.review.current) !==
              JSON.stringify(input.current) ||
            command.review.expiresAt <= now ||
            (command.phase.status !== "prepared" &&
              command.phase.status !== "approved")
          ) {
            return yield* failure("Conflict");
          }
          if (input.mode === "once") {
            return yield* save(book, {
              ...command,
              phase: { approval: { kind: "once" }, status: "approved" },
            });
          }
          const grant = activeGrant(book, command) ?? {
            createdAt: now,
            grantId: crypto.randomUUID(),
            scope: {
              operation: command.review.change.operation,
              stationId: input.stationId,
            },
          };
          const grants = [
            ...book.grants.filter((item) => item.grantId !== grant.grantId),
            grant,
          ];
          if (grants.length > 32) {
            return yield* failure("RateLimited");
          }
          return yield* save(
            { ...book, grants },
            {
              ...command,
              phase: {
                approval: { grantId: grant.grantId, kind: "grant" },
                status: "approved",
              },
            }
          );
        })
      ),
    executeCommand: (input: typeof CommandInput.Type) =>
      connection.run(input.stationId, (token, connectionId) =>
        Effect.gen(function* executeCommand() {
          const book = yield* bookFor(connectionId);
          const command = yield* find(book, input);
          switch (command.phase.status) {
            case "verified":
            case "rejected": {
              return command;
            }
            case "dispatching":
            case "accepted":
            case "outcome_unknown": {
              return yield* reconcile(
                book,
                command,
                command.phase.attemptedAt,
                token
              );
            }
            case "prepared": {
              return yield* failure("ApprovalRequired");
            }
            case "approved": {
              break;
            }
            default: {
              return absurd<never>(command.phase);
            }
          }
          if (!enabled) {
            return yield* failure("UnsupportedCapability");
          }
          if (command.review.expiresAt <= (yield* Clock.currentTimeMillis)) {
            return yield* save(book, {
              ...command,
              phase: { reason: "Conflict", status: "rejected" },
            });
          }
          if (
            command.phase.approval.kind === "grant" &&
            activeGrant(book, command)?.grantId !==
              command.phase.approval.grantId
          ) {
            return yield* failure("ApprovalRequired");
          }
          const current = yield* client.inspectControl(
            input.stationId,
            command.review.change,
            token
          );
          yield* client.validateControl(
            input.stationId,
            command.review.change,
            current,
            token
          );
          if (
            snapshotConfiguration(current) !==
            snapshotConfiguration(command.review.current)
          ) {
            return yield* save(book, {
              ...command,
              phase: { reason: "Conflict", status: "rejected" },
            });
          }
          const attemptedAt = yield* Clock.currentTimeMillis;
          if (command.review.expiresAt <= attemptedAt) {
            return yield* save(book, {
              ...command,
              phase: { reason: "Conflict", status: "rejected" },
            });
          }
          yield* save(book, {
            ...command,
            phase: { attemptedAt, status: "dispatching" },
          });
          const result = yield* client
            .dispatchControl(input.stationId, command.review.change, token)
            .pipe(Effect.result);
          if (result._tag === "Failure") {
            const { reason } = result.failure;
            return yield* save(book, {
              ...command,
              phase:
                reason === "AuthenticationRequired" ||
                reason === "PermissionDenied" ||
                reason === "RateLimited"
                  ? { reason, status: "rejected" }
                  : { attemptedAt, reason, status: "outcome_unknown" },
            });
          }
          yield* save(book, {
            ...command,
            phase: { attemptedAt, status: "accepted" },
          });
          return yield* reconcile(book, command, attemptedAt, token);
        })
      ),
    getCommand: (input: typeof CommandInput.Type) =>
      connection.run(input.stationId, (_token, connectionId) =>
        bookFor(connectionId).pipe(Effect.flatMap((book) => find(book, input)))
      ),
    prepareCommand: (input: typeof PrepareCommandInput.Type) =>
      connection.run(input.stationId, (token, connectionId) =>
        Effect.gen(function* prepareCommand() {
          const book = yield* bookFor(connectionId);
          const existing = book.commands.find(
            (item) => item.review.commandId === input.commandId
          );
          if (existing !== undefined) {
            if (
              existing.review.stationId !== input.stationId ||
              JSON.stringify(existing.review.change) !==
                JSON.stringify(input.change)
            ) {
              return yield* failure("Conflict");
            }
            return existing;
          }
          if (book.commands.length >= 256) {
            return yield* failure("RateLimited");
          }
          const current = yield* client.inspectControl(
            input.stationId,
            input.change,
            token
          );
          yield* client.validateControl(
            input.stationId,
            input.change,
            current,
            token
          );
          const preparedAt = yield* Clock.currentTimeMillis;
          const review = {
            ...input,
            current,
            expiresAt: preparedAt + 300_000,
            preparedAt,
          };
          const command: Command = {
            phase: { status: "prepared" },
            review: {
              ...review,
              reviewFingerprint: yield* fingerprint(review),
            },
          };
          const grant = activeGrant(book, command);
          const result: Command =
            grant === undefined
              ? command
              : {
                  ...command,
                  phase: {
                    approval: { grantId: grant.grantId, kind: "grant" },
                    status: "approved",
                  },
                };
          yield* storage.write({
            ...book,
            commands: [...book.commands, result],
          });
          return result;
        })
      ),
    revokeApproval: (input: typeof RevokeApprovalInput.Type) =>
      connection.run(input.stationId, (_token, connectionId) =>
        Effect.gen(function* revokeApproval() {
          const book = yield* bookFor(connectionId);
          const grants = book.grants.filter(
            (grant) =>
              !(
                grant.grantId === input.grantId &&
                grant.scope.stationId === input.stationId
              )
          );
          yield* storage.write({ ...book, grants });
          return { grants };
        })
      ),
  };
};
