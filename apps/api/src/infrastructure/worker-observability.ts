import type { WorkerProps } from "alchemy/Cloudflare/Workers";

/** Full native request and binding visibility; Effect hosts also provide Telemetry. */
export const workerObservability = {
  compatibility: { date: "2026-09-25", flags: ["nodejs_compat"] },
  observability: {
    enabled: true,
    headSamplingRate: 1,
    logs: {
      enabled: true,
      headSamplingRate: 1,
      invocationLogs: true,
      persist: true,
    },
    traces: { enabled: true, headSamplingRate: 1, persist: true },
  },
} satisfies Pick<WorkerProps, "compatibility" | "observability">;
