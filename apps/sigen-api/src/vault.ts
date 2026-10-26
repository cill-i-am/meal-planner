import { Buffer } from "node:buffer";

import { Enrollment, TokenBundle, failure } from "@meal-planner/sigen";
import { Effect, Redacted, Schema } from "effect";

export const EncryptedSecret = Schema.Struct({
  cipher: Schema.String.check(
    Schema.isMaxLength(65_536),
    Schema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/u)
  ),
  iv: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9+/]{16}$/u)),
  version: Schema.Literal(1),
});
export type EncryptedSecret = typeof EncryptedSecret.Type;
const Secret = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("enrollment"), value: Enrollment }),
  Schema.Struct({ kind: Schema.Literal("tokens"), value: TokenBundle }),
]);
type Secret = typeof Secret.Type;
const aad = new TextEncoder().encode("sigen-owner-v1");
const storageFailure = () => failure("StorageUnavailable");

export const makeVault = (secret: Redacted.Redacted<string>) => {
  const key = Effect.tryPromise({
    catch: storageFailure,
    try: () => {
      const value = Redacted.value(secret);
      if (!/^[a-f0-9]{64}$/u.test(value)) {
        throw new Error("Invalid encryption configuration");
      }
      return crypto.subtle.importKey(
        "raw",
        Uint8Array.from(Buffer.from(value, "hex")),
        "AES-GCM",
        false,
        ["encrypt", "decrypt"]
      );
    },
  });
  return {
    decrypt: (input: EncryptedSecret) =>
      Effect.gen(function* decryptSecret() {
        const encrypted = yield* Schema.decodeUnknownEffect(EncryptedSecret)(
          input
        ).pipe(Effect.mapError(storageFailure));
        const cryptoKey = yield* key;
        const bytes = yield* Effect.tryPromise({
          catch: storageFailure,
          try: () =>
            crypto.subtle.decrypt(
              {
                additionalData: aad,
                iv: Uint8Array.from(Buffer.from(encrypted.iv, "base64")),
                name: "AES-GCM",
              },
              cryptoKey,
              Uint8Array.from(Buffer.from(encrypted.cipher, "base64"))
            ),
        });
        return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Secret))(
          new TextDecoder().decode(bytes)
        ).pipe(Effect.map(Redacted.make), Effect.mapError(storageFailure));
      }),
    encrypt: (value: Redacted.Redacted<Secret>) =>
      Effect.gen(function* encryptSecret() {
        const cryptoKey = yield* key;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = yield* Effect.tryPromise({
          catch: storageFailure,
          try: () =>
            crypto.subtle.encrypt(
              { additionalData: aad, iv, name: "AES-GCM" },
              cryptoKey,
              new TextEncoder().encode(JSON.stringify(Redacted.value(value)))
            ),
        });
        return {
          cipher: Buffer.from(cipher).toString("base64"),
          iv: Buffer.from(iv).toString("base64"),
          version: 1 as const,
        };
      }),
  };
};
