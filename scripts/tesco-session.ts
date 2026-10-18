import { readFile, stat, writeFile } from "node:fs/promises";

import { Effect, Redacted, Schema } from "effect";

import {
  TescoConnectionHealth,
  TescoSessionCredentials,
} from "../apps/api/src/features/tesco/mcp/session.model.js";

const EnrollmentFile = Schema.Struct({
  executorToken: Schema.optionalKey(Schema.String),
  operatorToken: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  session: TescoSessionCredentials,
});

/** Credentials travel in a mode-0600 file and HTTPS body, never command-line arguments or output. */
const enroll = Effect.gen(function* enrollTescoSession() {
  const file = process.argv.at(2);
  if (file === undefined) {
    return yield* Effect.fail("A protected enrollment file is required.");
  }
  const attributes = yield* Effect.tryPromise(() => stat(file));
  // eslint-disable-next-line no-bitwise -- stat.mode is a POSIX permission bitmask.
  if ((attributes.mode & 0o077) !== 0) {
    return yield* Effect.fail(
      "Enrollment file must be readable only by its owner."
    );
  }
  const json = yield* Effect.tryPromise(() => readFile(file, "utf-8"));
  const input = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(EnrollmentFile)
  )(json).pipe(Effect.map(Redacted.make));
  const { executorToken, operatorToken, session } = Redacted.value(input);
  const send = Effect.tryPromise({
    catch: () => "Unable to contact the private Tesco MCP.",
    try: (signal) =>
      fetch("https://tesco-mcp.barroncillian.workers.dev/admin/session", {
        body: JSON.stringify(session),
        headers: {
          authorization: `Bearer ${operatorToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal,
      }),
  }).pipe(
    Effect.flatMap((response) =>
      Effect.gen(function* decodeEnrollmentResponse() {
        if (response.status !== 200) {
          return yield* Effect.fail(
            `Enrollment failed with HTTP ${response.status}.`
          );
        }
        const result: unknown = yield* Effect.tryPromise({
          catch: () => "Invalid enrollment response.",
          try: (): Promise<unknown> => response.json(),
        });
        return yield* Schema.decodeUnknownEffect(TescoConnectionHealth)(result);
      })
    )
  );
  return yield* send.pipe(
    Effect.timeout("60 seconds"),
    Effect.ensuring(
      Effect.promise(() =>
        writeFile(file, JSON.stringify({ executorToken, operatorToken }), {
          mode: 0o600,
        })
      )
    )
  );
});

// CLI process boundary: diagnostics cannot render a SchemaError containing a session credential.
await Effect.runPromise(
  enroll.pipe(
    Effect.match({
      onFailure: () => {
        console.error(
          "Tesco session enrollment failed. Check the operator credential, file permissions and fresh Tesco sign-in."
        );
        process.exitCode = 1;
      },
      onSuccess: (health) => {
        console.log(JSON.stringify(health));
      },
    })
  )
);
