import { Effect, Schema } from "effect";

import { Sha256Hex } from "./import-media.model.js";

/** Encode digest bytes as lowercase hexadecimal. */
export const bytesToHex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

/** Hash the supplied bytes, preserving their caller-owned encoding. */
export const sha256Bytes = (bytes: Uint8Array): Effect.Effect<Sha256Hex> =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  ).pipe(
    Effect.map((digest) =>
      Schema.decodeUnknownSync(Sha256Hex)(bytesToHex(digest))
    )
  );

/** Decode a verified SHA-256 value for native R2 checksum options. */
export const checksumBytes = (hex: Sha256Hex): ArrayBuffer => {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
};
