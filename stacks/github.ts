import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Random from "alchemy/Random";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export default Alchemy.Stack(
  "MealPlannerGitHub",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* GitHubCredentials() {
    const repository = { owner: "cill-i-am", repository: "meal-planner" };
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const zoneId = yield* Config.String("CEIRD_ZONE_ID");
    const secretNames = [
      "BETTER_AUTH_SECRET",
      "MEAL_PLANNER_IMPORT_API_TOKEN",
      "MEAL_PLANNER_IMPORT_ACTOR_ID",
      "MEAL_PLANNER_IMPORT_HOUSEHOLD_SCOPE_ID",
    ] as const;

    for (const name of ["production", "preview"] as const) {
      const production = name === "production";
      const environmentProps: GitHub.EnvironmentProps = {
        ...repository,
        name,
      };
      if (production) {
        environmentProps.deploymentBranchPolicy = {
          customBranchPolicies: ["main"],
        };
      }
      const environment = yield* GitHub.Environment(
        `${name}Environment`,
        environmentProps
      );
      const token = yield* Cloudflare.ApiToken.AccountApiToken(
        `${name}CloudflareToken`,
        {
          accountId,
          expiresOn: "2027-10-03T00:00:00Z",
          name: `meal-planner-github-${name}`,
          policies: [
            {
              effect: "allow",
              permissionGroups: [
                "Workers Scripts Write",
                "Workers R2 Storage Write",
                "D1 Write",
                "Queues Write",
                "Workers Containers Write",
                "AI Gateway Write",
                "Secrets Store Write",
                "Account Settings Read",
                ...(production ? (["Email Sending Read"] as const) : []),
              ],
              resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
            },
            ...(production
              ? ([
                  {
                    effect: "allow" as const,
                    permissionGroups: ["Zone Read", "Workers Routes Write"],
                    resources: {
                      [`com.cloudflare.api.account.${accountId}`]: {
                        [`com.cloudflare.api.account.zone.${zoneId}`]: "*",
                      },
                    },
                  },
                ] satisfies Cloudflare.ApiToken.Policy[])
              : []),
          ],
        }
      );
      yield* GitHub.Secret(`${name}CloudflareApiToken`, {
        ...repository,
        environment,
        name: "CLOUDFLARE_API_TOKEN",
        value: token.value,
      });
      yield* GitHub.Variable(`${name}CloudflareAccount`, {
        ...repository,
        environment,
        name: "CLOUDFLARE_ACCOUNT_ID",
        value: accountId,
      });
      if (production) {
        yield* GitHub.Variable("ProductionZone", {
          ...repository,
          environment,
          name: "CEIRD_ZONE_ID",
          value: zoneId,
        });
      }
      for (const secretName of secretNames) {
        const value = production
          ? yield* Config.Redacted(secretName)
          : yield* Random.makeRandom(`Preview${secretName}`, { bytes: 32 });
        yield* GitHub.Secret(`${name}${secretName}`, {
          ...repository,
          environment,
          name: secretName,
          value,
        });
      }
    }

    yield* GitHub.Variable("EnableDeployments", {
      ...repository,
      name: "ALCHEMY_DEPLOYMENTS_ENABLED",
      value: String(
        yield* Config.Boolean("ALCHEMY_DEPLOYMENTS_ENABLED").pipe(
          Config.withDefault(false)
        )
      ),
    });

    return { accountId, repository: "cill-i-am/meal-planner" };
  })
);
