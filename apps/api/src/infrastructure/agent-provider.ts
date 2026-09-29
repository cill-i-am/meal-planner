import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

/** Stage-owned gateway and account token for the two private Agent Workers. */
export const AgentProvider = Effect.gen(function* AgentProvider() {
  const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
  const gateway = yield* Cloudflare.AI.Gateway("AgentProviderGateway", {
    cacheTtl: null,
    collectLogs: false,
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
  });
  const token = yield* Cloudflare.ApiToken.AccountApiToken(
    "AgentProviderToken",
    {
      policies: [
        {
          effect: "allow",
          permissionGroups: ["Workers AI Read"],
          resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
        },
      ],
    }
  );
  return {
    accountId: token.accountId,
    apiToken: token.value,
    conversationConfig: gateway.gatewayId.pipe(
      Output.map((gatewayId) =>
        JSON.stringify({
          gatewayId,
          maxOutputTokens: 8192,
          model: "openai/gpt-6-luna",
          provider: "cloudflare-responses",
          timeoutMs: 120_000,
        })
      )
    ),
    gatewayId: gateway.gatewayId,
    privateDiscoveryConfig: gateway.gatewayId.pipe(
      Output.map((gatewayId) =>
        JSON.stringify({
          gatewayId,
          inputUsdPerMillionTokens: 0.1,
          maxOutputTokens: 8192,
          model: "openai/gpt-6-luna",
          outputUsdPerMillionTokens: 0.5,
          provider: "cloudflare-responses",
          timeoutMs: 120_000,
        })
      )
    ),
  };
});
