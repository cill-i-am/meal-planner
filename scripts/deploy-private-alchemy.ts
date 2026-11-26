import { execFileSync } from "node:child_process";

import * as Alchemist from "alchemy/Alchemist";
import { Effect, Exit, Schema } from "effect";
import { MinimumLogLevel } from "effect/References";

import {
  LiveSettings,
  readSigenPolicy,
  requireLiveBindings,
  requireSafePlan,
  targetSpecs,
} from "./private-release.js";

const { argv, env } = process;
const [integration] = argv.slice(2);
const account = env["CLOUDFLARE_ACCOUNT_ID"];
const token = env["CLOUDFLARE_API_TOKEN"];
const mode = env["INTEGRATION_DEPLOY_MODE"];
const sha = env["GITHUB_SHA"];

if (
  (integration !== "tesco" && integration !== "sigen") ||
  (mode !== "plan" && mode !== "apply") ||
  env["GITHUB_ACTIONS"] !== "true" ||
  env["CI"] !== "true" ||
  env["GITHUB_EVENT_NAME"] !== "push" ||
  (mode === "apply" && env["GITHUB_RUN_ATTEMPT"] !== "1") ||
  env["GITHUB_REF"] !== "refs/heads/main" ||
  !sha ||
  !/^[a-f0-9]{40}$/u.test(sha) ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim() !==
    sha ||
  execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    encoding: "utf-8",
  }).trim() !== "" ||
  !account ||
  !/^[a-f0-9]{32}$/u.test(account) ||
  !token
) {
  throw new Error(
    "Refusing private release without the tested main revision, deployment mode and Cloudflare environment."
  );
}

const target = targetSpecs[integration];
if (integration === "sigen") {
  Object.assign(env, readSigenPolicy(env["SIGEN_DEPLOY_POLICY_JSON"] ?? ""));
  delete env["SIGEN_DEPLOY_POLICY_JSON"];
}
const authNames = target.secretNames.filter(
  (name) => name.endsWith("SHA256") || name.endsWith("ENCRYPTION_KEY")
);
if (authNames.some((name) => !/^[a-f0-9]{64}$/u.test(env[name] ?? ""))) {
  throw new Error(
    "Required existing integration credentials are missing or malformed."
  );
}

let phase = "live binding check";
const run = Effect.gen(function* runPrivateRelease() {
  yield* Effect.tryPromise({
    catch: () =>
      "Live Worker metadata did not confirm the expected secret names and namespace.",
    try: async () => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${target.worker}/settings`,
        {
          headers: { authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (!response.ok) {
        throw new Error("Worker settings unavailable.");
      }
      const settings = Schema.decodeUnknownSync(LiveSettings)(
        await response.json()
      );
      requireLiveBindings(settings, target);
    },
  });
  phase = "existing state planning";
  const stack = yield* Alchemist.importStack(target.entry);
  const plan = yield* Alchemist.plan({
    adopt: false,
    dev: false,
    operation: "deploy",
    profile: "ci",
    stage: "prod",
    stack,
    updateStateStore: false,
  }).pipe(
    Effect.mapError(
      () => "Alchemy could not plan against existing Cloudflare state."
    )
  );
  phase = "plan safety guard";
  const action = yield* Effect.try({
    catch: () =>
      "Alchemy plan did not preserve existing Worker ownership and bindings.",
    try: () => requireSafePlan(plan, target, account),
  });
  yield* Effect.sync(() => {
    process.stdout.write(
      `${integration} ${sha}: guarded plan ${action}; Worker, Durable Object, and binding identities verified.\n`
    );
  });
  if (mode === "apply" && action === "update") {
    phase = "apply (inspect production state before retrying)";
    yield* Alchemist.apply(plan).pipe(
      Effect.mapError(
        () => "Alchemy apply failed; inspect production state before retrying."
      )
    );
    yield* Effect.sync(() =>
      process.stdout.write(`${integration}: guarded plan applied.\n`)
    );
  }
});

const outcome = await Effect.runPromiseExit(
  run.pipe(
    Effect.provide(Alchemist.layer()),
    Effect.provideService(MinimumLogLevel, "None"),
    Effect.scoped
  )
);
if (Exit.isFailure(outcome)) {
  process.stderr.write(
    `Private integration release failed during ${phase}. No automatic retry or recovery was attempted.\n`
  );
  process.exitCode = 1;
}
