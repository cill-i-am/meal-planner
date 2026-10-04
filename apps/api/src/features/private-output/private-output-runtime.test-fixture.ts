import type { MiniflareWorkerConfig } from "miniflare";

import { workerObservability } from "../../infrastructure/worker-observability.js";

export const privateOutputTestBindings = {
  PrivateOutputApi: {
    exportName: "PrivateOutputApi",
    type: "worker",
    worker: "private-output",
  },
  PrivateOutputMutations: {
    exportName: "PrivateOutputMutations",
    type: "worker",
    worker: "private-output",
  },
} as const;

export const privateOutputRuntimeWorker = (
  manifest: NonNullable<MiniflareWorkerConfig["manifest"]>
) =>
  ({
    config: {
      compatibilityDate: workerObservability.compatibility.date,
      compatibilityFlags: workerObservability.compatibility.flags,
      env: {
        AccountOutputLifecycle: {
          exportName: "AccountOutputLifecycle",
          type: "durable-object",
          worker: "private-output",
        },
        HouseholdAgent: {
          exportName: "HouseholdAgent",
          type: "durable-object",
          worker: "private-output",
        },
        PrivateInterviewDirectory: {
          exportName: "PrivateInterviewDirectory",
          type: "durable-object",
          worker: "private-output",
        },
        PrivateInterviewSession: {
          exportName: "PrivateInterviewSession",
          type: "durable-object",
          worker: "private-output",
        },
      },
      exports: {
        AccountOutputLifecycle: { storage: "sqlite", type: "durable-object" },
        HouseholdAgent: { storage: "sqlite", type: "durable-object" },
        PrivateInterviewDirectory: {
          storage: "sqlite",
          type: "durable-object",
        },
        PrivateInterviewSession: { storage: "sqlite", type: "durable-object" },
        PrivateOutputApi: { type: "worker" },
        PrivateOutputMutations: { type: "worker" },
      },
      manifest,
      name: "private-output",
    },
  }) satisfies { config: MiniflareWorkerConfig };

export const privateOutputControlWorker = (
  manifest: NonNullable<MiniflareWorkerConfig["manifest"]>
) =>
  ({
    config: {
      compatibilityDate: workerObservability.compatibility.date,
      compatibilityFlags: workerObservability.compatibility.flags,
      env: privateOutputRuntimeWorker(manifest).config.env,
      manifest,
      name: "private-output-control",
    },
  }) satisfies { config: MiniflareWorkerConfig };
