import { Context, Effect, Redacted } from "effect";

import type { ImportPrincipal } from "./import-intent.js";
import { unauthorizedImportCaller } from "./import.errors.js";
import type { UnauthorizedImportCaller } from "./import.errors.js";

const hmacAlgorithm = { hash: "SHA-256", name: "HMAC" } as const;
const challenge = new TextEncoder().encode("meal-planner-import-auth-v1");
const rejectUnauthorized = () => Effect.fail(unauthorizedImportCaller());

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
  const token = match?.groups?.["token"];
  return token === undefined ? undefined : Redacted.make(token);
};

export interface ImportAuthorizerShape {
  readonly authorize: (
    authorization: string | undefined
  ) => Effect.Effect<ImportPrincipal, UnauthorizedImportCaller>;
  readonly authorizeBearer: (
    token: Redacted.Redacted<string>
  ) => Effect.Effect<ImportPrincipal, UnauthorizedImportCaller>;
}

export const makeImportAuthorizer = (options: {
  readonly expectedToken: Redacted.Redacted<string>;
  readonly principal: ImportPrincipal;
}): Effect.Effect<ImportAuthorizerShape> => {
  const expectedValue = Redacted.value(options.expectedToken);
  if (expectedValue.length === 0) {
    return Effect.succeed({
      authorize: rejectUnauthorized,
      authorizeBearer: rejectUnauthorized,
    });
  }

  return Effect.map(
    Effect.promise(() => importHmacKey(expectedValue)),
    (key) => {
      const authorizeBearer = (token: Redacted.Redacted<string>) => {
        const suppliedValue = Redacted.value(token);
        if (suppliedValue.length === 0) {
          return Effect.fail(unauthorizedImportCaller());
        }
        return Effect.flatMap(
          Effect.promise(async () => {
            const suppliedKey = await importHmacKey(suppliedValue);
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
            matches
              ? Effect.succeed(options.principal)
              : Effect.fail(unauthorizedImportCaller())
        );
      };
      return {
        authorize: (authorization: string | undefined) => {
          const token = bearerToken(authorization);
          return token === undefined
            ? Effect.fail(unauthorizedImportCaller())
            : authorizeBearer(token);
        },
        authorizeBearer,
      };
    }
  );
};

export class ImportAuthorizer extends Context.Service<
  ImportAuthorizer,
  ImportAuthorizerShape
>()("meal-planner/ImportAuthorizer") {}
