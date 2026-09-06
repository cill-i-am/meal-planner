import type { MiniflareWorkerConfig } from "miniflare";

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
      compatibilityDate: "2026-07-14",
      compatibilityFlags: ["nodejs_compat"],
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
        PrivateInterviewSession: {
          exportName: "PrivateInterviewSession",
          type: "durable-object",
          worker: "private-output",
        },
      },
      exports: {
        AccountOutputLifecycle: { storage: "sqlite", type: "durable-object" },
        HouseholdAgent: { storage: "sqlite", type: "durable-object" },
        PrivateInterviewSession: { storage: "sqlite", type: "durable-object" },
        PrivateOutputApi: { type: "worker" },
        PrivateOutputMutations: { type: "worker" },
      },
      manifest,
      name: "private-output",
      type: "worker",
    },
  }) satisfies { config: MiniflareWorkerConfig };

export const privateOutputControlWorker = (
  manifest: NonNullable<MiniflareWorkerConfig["manifest"]>
) =>
  ({
    config: {
      compatibilityDate: "2026-07-14",
      compatibilityFlags: ["nodejs_compat"],
      env: privateOutputRuntimeWorker(manifest).config.env,
      manifest,
      name: "private-output-control",
      type: "worker",
    },
  }) satisfies { config: MiniflareWorkerConfig };
