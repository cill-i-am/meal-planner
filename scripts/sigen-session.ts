import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { Effect, Schema } from "effect";

import { readJson } from "../apps/sigen-api/src/http.js";
import { SessionReport } from "../apps/sigen-api/src/session.js";
import { ConnectionStatus, Enrollment } from "../packages/sigen/src/model.js";

const OperatorFile = Schema.Struct({
  enrollment: Schema.optionalKey(Enrollment),
  operatorToken: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  origin: Schema.String.check(
    Schema.isPattern(/^https:\/\/sigen-api\.[a-z0-9-]+\.workers\.dev$/u)
  ),
});
const [file, action] = process.argv.slice(2);
const actions = new Set(["enroll", "status", "disconnect"]);
if (file === undefined || action === undefined || !actions.has(action)) {
  throw new Error(
    "Usage: sigen-session.ts /absolute/protected.json enroll|status|disconnect"
  );
}

try {
  // eslint-disable-next-line no-bitwise -- Native filesystem flags must be combined bitwise.
  const handle = await open(file, constants.O_RDWR | constants.O_NOFOLLOW);
  let config: typeof OperatorFile.Type;
  try {
    const stat = await handle.stat();
    // eslint-disable-next-line no-bitwise -- Reject group/world-readable credential files.
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 65_536) {
      throw new Error("Use a protected regular file");
    }
    config = Schema.decodeUnknownSync(Schema.fromJsonString(OperatorFile))(
      await handle.readFile("utf-8")
    );
    if (action === "enroll" && config.enrollment === undefined) {
      throw new Error("Missing enrollment");
    }
    if (config.enrollment !== undefined) {
      const retained = JSON.stringify({
        operatorToken: config.operatorToken,
        origin: config.origin,
      });
      await handle.truncate(0);
      await handle.write(retained, 0, "utf-8");
      await handle.sync();
    }
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
    signal: AbortSignal.timeout(20_000),
  };
  if (action === "enroll") {
    init.body = JSON.stringify(config.enrollment);
  }
  const response = await fetch(`${config.origin}/admin/session`, init);
  if (!response.ok) {
    throw new Error("Operator request failed");
  }
  if (action === "disconnect") {
    process.stdout.write("Disconnected. No physical settings were changed.\n");
  } else {
    const bodyInit: RequestInit & { duplex: "half" } = {
      body: response.body,
      duplex: "half",
      method: "POST",
    };
    const raw = await Effect.runPromise(
      readJson(new Request("https://response.invalid", bodyInit)).pipe(
        Effect.scoped
      )
    );
    const result =
      action === "status"
        ? Schema.decodeUnknownSync(SessionReport)(raw)
        : Schema.decodeUnknownSync(ConnectionStatus)(raw);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch {
  process.stderr.write(
    "Sigen operator request failed. No credential details were logged. Check status before retrying enrollment.\n"
  );
  process.exitCode = 1;
}
