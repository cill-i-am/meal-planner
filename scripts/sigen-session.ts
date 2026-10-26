import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { NodeServices } from "@effect/platform-node";
import { Effect, Redacted, Schema } from "effect";
import { Prompt } from "effect/cli";

import { readJson } from "../apps/sigen-api/src/http.js";
import { SessionReport } from "../apps/sigen-api/src/session.js";
import {
  ConnectionStatus,
  Enrollment,
  FailureReason,
  StationId,
} from "../packages/sigen/src/model.js";

const OperatorFile = Schema.Struct({
  operatorToken: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  origin: Schema.String.check(
    Schema.isPattern(/^https:\/\/sigen-api\.[a-z0-9-]+\.workers\.dev$/u)
  ),
  stationId: StationId,
});
const [file, action] = process.argv.slice(2);
const actions = new Set(["enroll", "status", "disconnect"]);
if (file === undefined || action === undefined || !actions.has(action)) {
  throw new Error(
    "Usage: sigen-session.ts /absolute/protected.json enroll|status|disconnect"
  );
}

const readResponse = (response: Response) => {
  const bodyInit: RequestInit & { duplex: "half" } = {
    body: response.body,
    duplex: "half",
    method: "POST",
  };
  return Effect.runPromise(
    readJson(new Request("https://response.invalid", bodyInit)).pipe(
      Effect.scoped
    )
  );
};
let publicFailure: typeof FailureReason.Type | undefined;
let upstreamHttpStatus: number | undefined;
try {
  // eslint-disable-next-line no-bitwise -- Native filesystem flags must be combined bitwise.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let config: typeof OperatorFile.Type;
  try {
    const stat = await handle.stat();
    // eslint-disable-next-line no-bitwise -- Reject group/world-readable credential files.
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 65_536) {
      throw new Error("Use a protected regular file");
    }
    config = Schema.decodeUnknownSync(Schema.fromJsonString(OperatorFile), {
      onExcessProperty: "error",
    })(await handle.readFile("utf-8"));
  } finally {
    await handle.close();
  }
  let method = "GET";
  if (action === "enroll") {
    method = "POST";
  }
  if (action === "disconnect") {
    method = "DELETE";
  }
  const init: RequestInit = {
    headers: {
      authorization: `Bearer ${config.operatorToken}`,
      "content-type": "application/json",
    },
    method,
    redirect: "error",
  };
  if (action === "enroll") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("Enrollment requires an interactive terminal");
    }
    const enrollment = await Effect.runPromise(
      Effect.gen(function* promptForEnrollment() {
        const username = yield* Prompt.String({ message: "mySigen username" });
        const password = yield* Prompt.Hidden({
          message: "mySigen password (hidden)",
        });
        const input = yield* Schema.decodeUnknownEffect(Enrollment)({
          password: Redacted.value(password),
          stationId: config.stationId,
          username,
        });
        return Redacted.make(input);
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
    );
    init.body = JSON.stringify(Redacted.value(enrollment));
  }
  const response = await fetch(`${config.origin}/admin/session`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const rejected = Schema.decodeUnknownSync(
      Schema.Struct({
        error: FailureReason,
        upstreamHttpStatus: Schema.optionalKey(
          Schema.Number.check(
            Schema.isInt(),
            Schema.isBetween({ maximum: 599, minimum: 100 })
          )
        ),
      })
    )(await readResponse(response));
    publicFailure = rejected.error;
    ({ upstreamHttpStatus } = rejected);
    throw new Error("Operator request failed");
  }
  if (action === "disconnect") {
    process.stdout.write("Disconnected. No physical settings were changed.\n");
  } else {
    const raw = await readResponse(response);
    const result =
      action === "status"
        ? Schema.decodeUnknownSync(SessionReport)(raw)
        : Schema.decodeUnknownSync(ConnectionStatus)(raw);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch {
  process.stderr.write(
    `Sigen operator request failed${publicFailure === undefined ? "" : `: ${publicFailure}`}${upstreamHttpStatus === undefined ? "" : ` (provider HTTP ${upstreamHttpStatus})`}. No credential details were logged. Check status before retrying enrollment.\n`
  );
  process.exitCode = 1;
}
