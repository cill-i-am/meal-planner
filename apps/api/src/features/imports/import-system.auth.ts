import { Context, Effect, Redacted } from "effect";

import type { ImportPrincipal } from "./import-intent.js";
import { unauthorizedImportCaller } from "./import.errors.js";
import type { UnauthorizedImportCaller } from "./import.errors.js";

const hmacAlgorithm = { hash: "SHA-256", name: "HMAC" } as const;
const challenge = new TextEncoder().encode("meal-planner-system-auth-v1");
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
  const match =
    authorization === undefined
      ? null
      : /^Bearer (?<token>[^\s]+)$/u.exec(authorization);
  return match?.groups?.["token"];
};

export interface ImportSystemAuthorizerShape {
  readonly authorize: (
    authorization: string | undefined
  ) => Effect.Effect<ImportPrincipal, UnauthorizedImportCaller>;
}

/** Construct the single internal automation credential boundary. */
export const makeImportSystemAuthorizer = (options: {
  readonly principal: ImportPrincipal;
  readonly token: Redacted.Redacted<string>;
}): Effect.Effect<ImportSystemAuthorizerShape> => {
  const expectedToken = Redacted.value(options.token);
  if (expectedToken.length === 0) {
    return Effect.succeed({ authorize: rejectUnauthorized });
  }
  return Effect.map(
    Effect.promise(() => importHmacKey(expectedToken)),
    (expectedKey) => ({
      authorize: (authorization) => {
        const suppliedToken = bearerToken(authorization);
        if (suppliedToken === undefined) {
          return rejectUnauthorized();
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
              expectedKey,
              signature,
              challenge
            );
          }),
          (matches) =>
            matches ? Effect.succeed(options.principal) : rejectUnauthorized()
        );
      },
    })
  );
};

/** System-only authorization capability for operational import routes. */
export class ImportSystemAuthorizer extends Context.Service<
  ImportSystemAuthorizer,
  ImportSystemAuthorizerShape
>()("meal-planner/ImportSystemAuthorizer") {}
