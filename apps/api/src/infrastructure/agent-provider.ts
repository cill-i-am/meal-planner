import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const AgentProvider = Effect.gen(function* AgentProvider() {
  const dev = yield* Alchemy.ALCHEMY_DEV;
  if (dev) {
    return {
      accountId: yield* Config.String("LOCAL_AGENT_ACCOUNT_ID").pipe(
        Config.withDefault("")
      ),
      apiToken: yield* Config.Redacted("LOCAL_AGENT_API_TOKEN").pipe(
        Config.withDefault(Redacted.make(""))
      ),
      conversationConfig: yield* Config.String(
        "LOCAL_AGENT_CONVERSATION_CONFIG"
      ).pipe(Config.withDefault("")),
      gatewayId: yield* Config.String("LOCAL_AGENT_GATEWAY_ID").pipe(
        Config.withDefault("")
      ),
      privateDiscoveryConfig: yield* Config.String(
        "LOCAL_AGENT_PRIVATE_DISCOVERY_CONFIG"
      ).pipe(Config.withDefault("")),
    };
  }
  const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
  const gateway = yield* Cloudflare.AI.Gateway("AgentProviderGateway", {
    authentication: true,
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
