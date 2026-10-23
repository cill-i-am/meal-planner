import { UserId } from "@meal-planner/household-api";
import type { DBAdapter, DBTransactionAdapter, Where } from "better-auth";
import { Schema } from "effect";

import {
  privateOutputKey,
  PrivateOutputUnavailable,
} from "../private-output/private-output.contract.js";
import { currentNativeDelegation } from "./delegated-access.js";

export type AuthOutputFence = <A>(
  input: {
    readonly accountId: UserId;
    readonly intentKey: string;
    readonly replayable?: true;
    readonly reconcileOnly?: true;
  },
  canonical: () => Promise<A>
) => Promise<A>;

const Identity = Schema.Struct({ userId: UserId });
const parseIdentity = Schema.decodeUnknownSync(Identity);
const parseUserId = Schema.decodeUnknownSync(UserId);
const protectedModel = (model: string) =>
  model === "session" || model === "member";
const delegatedModel = (model: string) =>
  model === "oauthAccessToken" ||
  model === "oauthRefreshToken" ||
  model === "oauthConsent";
const unsupported = () =>
  new PrivateOutputUnavailable({ reason: "unsupported_mutation" });

const selector = (model: string, where: readonly Where[]) => {
  const [condition] = where;
  if (
    where.length !== 1 ||
    condition === undefined ||
    (condition.operator !== undefined && condition.operator !== "eq") ||
    (condition.connector !== undefined && condition.connector !== "AND") ||
    !Schema.is(Schema.String.pipe(Schema.check(Schema.isMinLength(1))))(
      condition.value
    ) ||
    !(
      (model === "session" &&
        (condition.field === "token" || condition.field === "userId")) ||
      (model === "member" && condition.field === "id")
    )
  ) {
    throw unsupported();
  }
  return { field: condition.field, value: condition.value };
};

interface AuthMutation {
  readonly model: string;
  readonly where: Where[];
  readonly update?: Record<string, unknown>;
}

const isSessionRefresh = (
  input: AuthMutation,
  action: string,
  selected: ReturnType<typeof selector>
) => {
  const fields = Object.keys(input.update ?? {});
  return (
    input.model === "session" &&
    action === "update" &&
    selected.field === "token" &&
    fields.length === 2 &&
    fields.includes("expiresAt") &&
    fields.includes("updatedAt")
  );
};

/** Fence every enabled canonical session/member mutation at Better Auth's public adapter boundary. */
export const fenceAuthAdapter = (
  adapter: DBAdapter,
  fence: AuthOutputFence,
  revokeUnusedCodes: (input: {
    readonly userId: UserId;
    readonly clientId: string;
  }) => Promise<void>
): DBAdapter => {
  const wrap = (source: DBTransactionAdapter): DBTransactionAdapter => {
    const fenceDelegatedMutation = async <A>(
      input: AuthMutation,
      action: string,
      canonical: () => Promise<A>
    ) => {
      const rows = Schema.decodeUnknownSync(
        Schema.Array(
          Schema.Struct({
            clientId: Schema.optional(Schema.String),
            userId: Schema.optional(Schema.NullOr(UserId)),
          })
        )
      )(await source.findMany({ model: input.model, where: input.where }));
      const accountIds = [
        ...new Set(
          rows.flatMap((row) =>
            row.userId === null || row.userId === undefined ? [] : [row.userId]
          )
        ),
      ].toSorted();
      const intentKey = await privateOutputKey(
        "oauth-mutation",
        JSON.stringify({ action, ...input })
      );
      let guarded = async () => {
        if (input.model === "oauthConsent" && action.startsWith("delete")) {
          // Native consent deletion leaves issued credentials behind. Delete
          // this user's client grant under the same fence so re-consent cannot
          // revive those credentials. The native provider still owns issuance.
          await Promise.all(
            rows.map(async (row) => {
              if (
                row.clientId === undefined ||
                row.userId === undefined ||
                row.userId === null
              ) {
                throw unsupported();
              }
              const where = [
                { field: "clientId", value: row.clientId },
                { field: "userId", value: row.userId },
              ];
              await revokeUnusedCodes({
                clientId: row.clientId,
                userId: row.userId,
              });
              await source.deleteMany({ model: "oauthRefreshToken", where });
              await source.deleteMany({ model: "oauthAccessToken", where });
            })
          );
        }
        return canonical();
      };
      for (const accountId of accountIds) {
        const next = guarded;
        guarded = () => fence({ accountId, intentKey }, next);
      }
      return guarded();
    };
    const mutate = async <A>(
      input: AuthMutation,
      action: string,
      absent: A,
      canonical: () => Promise<A>
    ): Promise<A> => {
      if (delegatedModel(input.model)) {
        return fenceDelegatedMutation(input, action, canonical);
      }
      if (!protectedModel(input.model)) {
        if (
          (input.model === "user" || input.model === "organization") &&
          action.startsWith("delete")
        ) {
          throw unsupported();
        }
        return canonical();
      }
      const selected = selector(input.model, input.where);
      if (input.update !== undefined) {
        const fields = Object.keys(input.update);
        if (input.model === "session") {
          if (
            fields.some(
              (field) =>
                field !== "activeOrganizationId" &&
                field !== "expiresAt" &&
                field !== "updatedAt"
            )
          ) {
            throw unsupported();
          }
        } else if (
          fields.length !== 1 ||
          fields[0] !== "role" ||
          !Schema.is(Schema.String)(input.update["role"]) ||
          input.update["role"].trim().length === 0
        ) {
          throw unsupported();
        }
      }
      const readAccount = async () => {
        const row = await source.findOne<unknown>({
          model: input.model,
          where: input.where,
        });
        return row === null ? null : parseIdentity(row).userId;
      };
      const accountId =
        selected.field === "userId"
          ? parseUserId(selected.value)
          : await readAccount();
      if (accountId === null) {
        return absent;
      }
      const intent = isSessionRefresh(input, action, selected)
        ? { kind: "session-refresh", token: selected.value }
        : {
            action,
            model: input.model,
            update: input.update,
            where: input.where,
          };
      // A retry recomputes refresh dates; the retained pre-dispatch operation still has one dispatch claim.
      const intentKey = await privateOutputKey(
        "auth-mutation",
        JSON.stringify(intent)
      );
      return fence({ accountId, intentKey }, async () => {
        // Unique token/member selectors cannot silently move to another account across the fence.
        if (selected.field !== "userId") {
          const currentAccount = await readAccount();
          if (currentAccount === null) {
            return absent;
          }
          if (currentAccount !== accountId) {
            throw unsupported();
          }
        }
        return canonical();
      });
    };
    return {
      ...source,
      consumeOne: (input) => {
        if (protectedModel(input.model)) {
          throw unsupported();
        }
        return delegatedModel(input.model)
          ? fenceDelegatedMutation(input, "consumeOne", () =>
              source.consumeOne(input)
            )
          : source.consumeOne(input);
      },
      delete: (input) =>
        mutate(input, "delete", undefined, () => source.delete(input)),
      deleteMany: (input) =>
        mutate(input, "deleteMany", 0, () => source.deleteMany(input)),
      incrementOne: (input) => {
        if (protectedModel(input.model)) {
          throw unsupported();
        }
        return delegatedModel(input.model)
          ? fenceDelegatedMutation(
              { ...input, update: { ...input.set, ...input.increment } },
              "incrementOne",
              () => source.incrementOne(input)
            )
          : source.incrementOne(input);
      },
      update: <T>(input: Parameters<DBTransactionAdapter["update"]>[0]) => {
        const delegated = currentNativeDelegation();
        if (
          delegated !== undefined &&
          input.model === "session" &&
          "activeOrganizationId" in input.update
        ) {
          // Organization endpoints may select/clear the browser's active family.
          // Delegated family context is request-local, so retain that session row.
          if (
            Object.keys(input.update).some(
              (field) =>
                field !== "activeOrganizationId" && field !== "updatedAt"
            )
          ) {
            throw unsupported();
          }
          return source.findOne<T>({ model: input.model, where: input.where });
        }
        return mutate(input, "update", null, () => source.update<T>(input));
      },
      updateMany: (input) =>
        mutate(input, "updateMany", 0, () => source.updateMany(input)),
    };
  };
  return {
    ...wrap(adapter),
    // The configured D1 adapter has transactions disabled; each statement commits before the fence settles.
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Better Auth exposes a transaction callback API.
    transaction: (callback) =>
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- The adapter callback receives its transaction-scoped public adapter.
      adapter.transaction((transaction) => callback(wrap(transaction))),
  };
};
