# Private integration deployments

Tesco and Sigenergy each release from a qualifying push to `main` after the existing Required checks job succeeds. The released revision is the exact tested push SHA. Application sources, stack entrypoints, workspace dependencies or lockfile, dependency patches, and release wiring can qualify a push. The jobs are independent of each other and of the Meal Planner deploy. Pull requests and manual CI runs do not deploy either private integration.

| Integration | Repository activation variable | Protected GitHub environment | Alchemy stack / stage | Worker |
| --- | --- | --- | --- | --- |
| Tesco | `TESCO_ALCHEMY_DEPLOYMENTS_ENABLED` | `tesco-production` | `TescoMcp` / `prod` | `tesco-mcp` |
| Sigenergy | `SIGEN_ALCHEMY_DEPLOYMENTS_ENABLED` | `sigen-production` | `SigenApi` / `prod` | `sigen-api` |

## First release

The two job expressions in CI are explicitly disabled in source. Variables and secrets alone cannot activate them. Remove the source guard for only one integration in a separately reviewed release PR after completing the preflight below. The existing Meal Planner deployment and concurrency are unchanged.

Keep both activation variables unset until the integration's environment is configured and reviewed. Restrict each environment to `main` and set an appropriate deployment reviewer for the first release. Each environment needs the existing correct `CLOUDFLARE_ACCOUNT_ID` variable and a scoped `CLOUDFLARE_API_TOKEN` secret. Confirm the token can read the Worker and access the existing Cloudflare state store using the pinned provider. A fresh CI profile derives state-store access by opening a temporary Cloudflare Edge Preview worker; a plan-only run does not apply the application plan, but its authentication is not a GET-only operation. It will not automatically bootstrap or upgrade a missing or older state store.

Provision the following environment secrets from the approved recovery copies of the **existing** values. Cloudflare's live settings endpoint confirms binding names, not contents. Do not regenerate an encryption key, change a token digest, re-enrol the owner, or substitute default Sigenergy controls to get a plan to pass.

- Tesco: `TESCO_EXECUTOR_TOKEN_SHA256`, `TESCO_OPERATOR_TOKEN_SHA256`, and `TESCO_SESSION_ENCRYPTION_KEY`.
- Sigenergy: `SIGEN_OWNER_TOKEN_SHA256`, `SIGEN_OPERATOR_TOKEN_SHA256`, and `SIGEN_SESSION_ENCRYPTION_KEY`.
- Sigenergy policy: `SIGEN_DEPLOY_POLICY_JSON` is a protected CI envelope for the three existing Worker secret names `SIGEN_CONTROLS_ENABLED`, `SIGEN_ENABLED_OPERATIONS`, and `SIGEN_ENABLED_ACTIVE_PROFILE_LIMITS`. Include each key with its existing string value. Preserve explicit empty allowlists; omit none of the keys. The workflow unpacks them under their original binding names.

Set `INTEGRATION_DEPLOY_MODE` to `plan`, then enable just that integration's repository variable and use a qualifying push. Check the existing account, `alchemy-state-store`, stack and stage, and compare the guarded plan to the current production deployment. A different local profile name does not by itself require migration; a different state store or a missing record does. Stop if ownership is unclear. Never work around a guard failure with adoption, an empty state store, or secret rotation.

Set the environment mode to `apply` only after approval. The next qualifying push runs the guard again and applies the same plan, only if it updates the existing Worker and does not change any bindings, adopt, create, replace, delete, or move ownership. A no-op does not publish a Worker version. The guard checks the live Durable Object namespace before planning and matches it to prior Alchemy state. Keep the existing owner session and verify read-only discovery and authenticated connection health after the first release.

A burst of pushes can displace an unstarted run under GitHub's current CI concurrency policy. If a qualifying release did not run, review the latest SHA and send a fresh qualifying push; apply mode explicitly refuses workflow reruns to prevent publishing a superseded SHA. If apply fails, inspect the actual Worker version, bindings and state before retrying. To pause an integration without affecting the other service, unset its own activation variable.

The old CLI commands and stack entrypoints remain available for operator-supervised recovery: see [Tesco](../apps/tesco/README.md) and [Sigenergy](../apps/sigen-api/README.md).
