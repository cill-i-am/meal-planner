import * as Cloudflare from "alchemy/Cloudflare";

/**
 * Dedicated private GAIA-118 provider gateway.
 *
 * The durable D1 ledger is authoritative; this gateway limit is a second,
 * provider-side fence. Evidence requests and responses are never retained.
 */
export const ImportProviderGateway = Cloudflare.AI.Gateway(
  "ImportProviderGateway",
  {
    cacheTtl: null,
    collectLogs: false,
    id: "meal-planner-pilot-gaia-118",
    spendLimits: {
      enabled: true,
      rules: [
        {
          enabled: true,
          limit: 1000,
          limitType: "cost",
          technique: "sliding",
          window: "7 days",
        },
      ],
    },
    zdr: true,
  }
);
