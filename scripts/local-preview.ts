import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Redacted, Schema } from "effect";

import { startLocalPreview } from "../apps/api/src/local/preview-runtime.js";
import { localPreviewCloudflare } from "./local-preview-cloudflare.js";

const { values } = parseArgs({
  options: {
    account: { type: "string" },
    "auth-database-id": { type: "string" },
    "data-directory": { type: "string" },
    gateway: { default: "default", type: "string" },
    login: { default: false, type: "boolean" },
    model: { default: "openai/gpt-6-luna", type: "string" },
    port: { default: "4399", type: "string" },
    profile: { type: "string" },
  },
});

try {
  if (values.profile === undefined || values.account === undefined) {
    throw new Error("Pass --profile NAME and --account CLOUDFLARE_ACCOUNT_ID.");
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const model = Schema.decodeUnknownSync(
    Schema.Literals(["openai/gpt-6-luna", "@cf/openai/gpt-oss-120b"])
  )(values.model);
  const dataDirectory = path.resolve(
    root,
    values["data-directory"] ?? ".alchemy/local-preview/data"
  );
  const credentials = await localPreviewCloudflare(
    values.profile,
    values.account,
    { refreshLogin: values.login }
  );
  const runtime = await startLocalPreview({
    accountId: credentials.accountId,
    apiToken: Redacted.value(credentials.token),
    authDatabaseId: values["auth-database-id"] ?? "meal-planner-local",
    dataDirectory,
    gatewayId: values.gateway,
    model,
    port: Number(values.port),
  });
  console.info(`Local preview: ${runtime.baseURL}`);
  console.info(`Workers AI account verified: ${credentials.accountName}`);
  console.info(`Local data: ${dataDirectory}`);
  console.info(`Chat model: ${model}. Email stays in local storage.`);
  await runtime.stopped;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Local preview failed."
  );
  process.exitCode = 1;
}
