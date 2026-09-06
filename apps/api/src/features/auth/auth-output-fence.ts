import type { DBAdapter, DBTransactionAdapter, Where } from "better-auth";
import { Schema } from "effect";

import {
  privateOutputKey,
  PrivateOutputUnavailable,
} from "../private-output/private-output.contract.js";

export type AuthOutputFence = <A>(
  input: { readonly accountId: string; readonly intentKey: string },
  canonical: () => Promise<A>
) => Promise<A>;

const Identity = Schema.Struct({ userId: Schema.String });
const protectedModel = (model: string) =>
  model === "session" || model === "member";
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
  fence: AuthOutputFence
): DBAdapter => {
  const wrap = (source: DBTransactionAdapter): DBTransactionAdapter => {
    const mutate = async <A>(
      input: AuthMutation,
      action: string,
      absent: A,
      canonical: () => Promise<A>
    ): Promise<A> => {
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
        return row === null
          ? null
          : Schema.decodeUnknownSync(Identity)(row).userId;
      };
      const accountId =
        selected.field === "userId" ? selected.value : await readAccount();
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
        return source.consumeOne(input);
      },
      delete: (input) =>
        mutate(input, "delete", undefined, () => source.delete(input)),
      deleteMany: (input) =>
        mutate(input, "deleteMany", 0, () => source.deleteMany(input)),
      incrementOne: (input) => {
        if (protectedModel(input.model)) {
          throw unsupported();
        }
        return source.incrementOne(input);
      },
      update: (input) =>
        mutate(input, "update", null, () => source.update(input)),
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
