import { Context, Effect, Redacted } from "effect";

import { unauthorizedImportCaller } from "./import.errors.js";
import type { UnauthorizedImportCaller } from "./import.errors.js";

const hmacAlgorithm = { hash: "SHA-256", name: "HMAC" } as const;
const challenge = new TextEncoder().encode("meal-planner-import-auth-v1");

const importHmacKey = (value: string) =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    hmacAlgorithm,
    false,
    ["sign", "verify"]
  );

const bearerToken = (authorization: string | undefined) => {
  if (authorization === undefined) {
    return;
  }
  const match = /^Bearer (?<token>[^\s]+)$/u.exec(authorization);
  return match?.groups?.["token"];
};

export interface ImportAuthorizerShape {
  readonly authorize: (
    authorization: string | undefined
  ) => Effect.Effect<void, UnauthorizedImportCaller>;
}

export const makeImportAuthorizer = (
  expectedToken: Redacted.Redacted<string>
): Effect.Effect<ImportAuthorizerShape> => {
  const expectedValue = Redacted.value(expectedToken);
  if (expectedValue.length === 0) {
    return Effect.succeed({
      authorize: () => Effect.fail(unauthorizedImportCaller()),
    });
  }

  return Effect.map(
    Effect.promise(() => importHmacKey(expectedValue)),
    (key) => ({
      authorize: (authorization) => {
        const suppliedToken = bearerToken(authorization);
        if (suppliedToken === undefined) {
          return Effect.fail(unauthorizedImportCaller());
        }
        return Effect.flatMap(
          Effect.promise(async () => {
            const suppliedKey = await importHmacKey(suppliedToken);
            const signature = await crypto.subtle.sign(
              hmacAlgorithm,
              suppliedKey,
              challenge
            );
            return crypto.subtle.verify(
              hmacAlgorithm,
              key,
              signature,
              challenge
            );
          }),
          (matches) =>
            matches ? Effect.void : Effect.fail(unauthorizedImportCaller())
        );
      },
    })
  );
};

export class ImportAuthorizer extends Context.Service<
  ImportAuthorizer,
  ImportAuthorizerShape
>()("meal-planner/ImportAuthorizer") {}
