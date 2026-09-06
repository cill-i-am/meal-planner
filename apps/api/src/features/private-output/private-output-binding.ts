// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- This ambient native module has no JavaScript import; include it in every production compiler program.
/// <reference path="./private-output-runtime.d.ts" />
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import type {
  AccountOutputLifecycle,
  HouseholdAgent,
} from "./output-lifecycle.js";
import type { PrivateInterviewDirectory } from "./private-interview-directory.js";
import type { PrivateInterviewSession } from "./private-interview-session.js";
import type {
  PrivateOutputApi,
  PrivateOutputMutations,
} from "./private-output-worker.js";

export class PrivateOutputWorker extends Cloudflare.Worker<PrivateOutputWorker>()(
  "PrivateOutputWorker",
  {
    compatibility: { date: "2026-07-14", flags: ["nodejs_compat"] },
    env: {
      AccountOutputLifecycle: Cloudflare.DurableObject<AccountOutputLifecycle>(
        "AccountOutputLifecycle"
      ),
      HouseholdAgent:
        Cloudflare.DurableObject<HouseholdAgent>("HouseholdAgent"),
      PrivateInterviewDirectory:
        Cloudflare.DurableObject<PrivateInterviewDirectory>(
          "PrivateInterviewDirectory"
        ),
      PrivateInterviewSession:
        Cloudflare.DurableObject<PrivateInterviewSession>(
          "PrivateInterviewSession"
        ),
    },
    main: Effect.sync(
      () => new URL("private-output-worker.ts", import.meta.url).href
    ),
    observability: { enabled: false },
    workersDev: false,
  }
) {}

export const PrivateOutputApiBinding = PrivateOutputWorker.pipe(
  Effect.map((worker) =>
    Cloudflare.Workers.WorkerEntrypoint(worker, "PrivateOutputApi")
  )
);
export const PrivateOutputMutationsBinding = PrivateOutputWorker.pipe(
  Effect.map((worker) =>
    Cloudflare.Workers.WorkerEntrypoint(worker, "PrivateOutputMutations")
  )
);

export type PrivateOutputMutationPort = Pick<
  PrivateOutputMutations,
  | "beginMutation"
  | "completeMutation"
  | "markDispatched"
  | "prepareMutation"
  | "readMutation"
>;
export type PrivateOutputApiPort = Pick<
  PrivateOutputApi,
  | "authorizeConnection"
  | "beginConnection"
  | "authorizeDirectoryConnection"
  | "beginDirectoryConnection"
  | "fetch"
>;

/** Read explicitly declared native service bindings at the foreign-runtime boundary. */
export const privateOutputMutationPort = Effect.gen(
  function* privateOutputMutationPort() {
    const environment = yield* Cloudflare.Workers.WorkerEnvironment;
    const port: PrivateOutputMutationPort =
      environment["PrivateOutputMutations"];
    return port;
  }
);
export const privateOutputApiPort = Effect.gen(
  function* privateOutputApiPort() {
    const environment = yield* Cloudflare.Workers.WorkerEnvironment;
    const port: PrivateOutputApiPort = environment["PrivateOutputApi"];
    return port;
  }
);
