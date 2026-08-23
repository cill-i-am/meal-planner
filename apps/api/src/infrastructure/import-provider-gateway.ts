import * as Cloudflare from "alchemy/Cloudflare";

/**
 * Dedicated private recipe-import provider gateway.
 *
 * The durable D1 ledger is authoritative; this gateway limit is a second,
 * provider-side fence. Gateway logging defaults off so an unwrapped request
 * fails closed; the installed adapters opt in per request with metadata-only
 * headers and never retain request or response payloads.
 */
export const ImportProviderGateway = Cloudflare.AI.Gateway(
  "ImportProviderGateway",
  {
    cacheTtl: null,
    collectLogs: false,
    id: "meal-planner-recipe-import",
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
