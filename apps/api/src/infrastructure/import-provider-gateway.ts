import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";

export const ImportProviderGatewayId = "meal-planner-recipe-import";

/**
 * Dedicated private recipe-import provider gateway.
 *
 * The durable D1 ledger is authoritative; this gateway limit is a second,
 * provider-side fence. Gateway logging defaults off so an unwrapped request
 * fails closed. Installed adapters also disable logging per request at the
 * Workers AI binding; redacted Worker events carry correlation metadata.
 * The physical gateway is account-wide; destroying a preview retains it.
 */
export const ImportProviderGateway = Cloudflare.AI.Gateway(
  "ImportProviderGateway",
  {
    cacheTtl: null,
    collectLogs: false,
    id: ImportProviderGatewayId,
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
).pipe(RemovalPolicy.retain());
