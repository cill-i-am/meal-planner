# Cloudflare E2E deployment

Status: active
Owner: Meal Planner

## Target

Deploy `codex/ai-native-family-journey` to the `MealPlanner` stack, `e2e` stage,
using the existing `ceird-admin-global` Alchemy profile. The user authorized the
Cloudflare deployment, a `ceird.app` subdomain, live agent inference and email
integration on 29 September 2026. This stage has its own data; local preview
accounts and family records remain local.

- App: `https://e2e.ceird.app`, with same-origin auth and app APIs.
- Mail: `noreply@mail.e2e.ceird.app`. The E2E stage owns this sending subdomain.
- Agent: GPT-6 Luna through a stage-owned Cloudflare AI Gateway and an
  account-owned token restricted to Workers AI inference.
- Private interviews use the same model provider, with their existing private
  storage, confirmation and budget boundaries.
- API, household and private-output Workers remain private service bindings.
- Provider payload logging and caching are disabled. Cloudflare Email preview
  must be disabled before enabling transactional delivery.

## Configuration and ownership

Alchemy owns the E2E Website domain, Workers, D1 databases, Durable Objects,
queues, workflows, private R2 evidence storage, recipe-import container,
gateways, inference token and sending subdomain. Import and agent gateways use
stage-derived physical names. The registered apex zone is not recreated.

The ignored `.env` contains generated auth and system-import secrets, opaque
system principal IDs, `CEIRD_ZONE_ID`, the E2E sender address and the delivery
flag. No model API key needs to be copied into a browser or source file.

The pinned Alchemy Email Sending resource cannot configure Email preview. After
creation, disable preview using the documented Cloudflare subdomain PATCH and
verify it with GET, then enable `MEAL_PLANNER_EMAIL_DELIVERY_ENABLED`. See
[operation instructions](../how-to/operate-infrastructure.md).

Use the guarded deploy command. A first deployment must prove the E2E stage has
no existing Worker/D1 targets or Alchemy state. Subsequent releases use the
existing D1 target, migration ledger, recovery bookmark and release digest.
Keep the checkout committed and clean for either preflight.

## Release commands

Set `ALCHEMY_PROFILE=ceird-admin-global` as well as the explicit profile flag.
The pinned bootstrap CLI builds its credential layer before applying the flag's
config override, so the environment selection is needed there.

After the release is committed and all checks pass, inspect the fresh stage:

```sh
ALCHEMY_PROFILE=ceird-admin-global pnpm d1:preflight fresh-inspect \
  --profile ceird-admin-global --stage e2e \
  --account 862c7693f07f3e0cdca26eae399bf5e4
```

Review its digest and use the same target with `pnpm alchemy:deploy`, passing
`--stage e2e --profile ceird-admin-global --fresh-account <account-id>
--fresh-evidence <digest>`. The wrapper rechecks the absence of existing
resources before opening Alchemy's approval prompt. Use `ALCHEMY_TUI=1` in a
terminal to see that prompt; `--yes` remains rejected by the wrapper.

For later releases, discover the stage's D1 target with `pnpm d1:preflight
discover`, save that target in the ignored `.alchemy/e2e/` directory, and use the
existing `inspect` then `--d1-target`/`--d1-evidence` deploy flow. Never reuse the
fresh path after resources have been created.

## Verification record

The account and active `ceird.app` zone were checked live. Before bootstrap,
Cloudflare listed no Workers or D1 databases, no sending subdomains and only
the apex DMARC DNS record. Workers Paid and R2 access were present; no
subscription changes were made. Alchemy's remote state store was bootstrapped.

The plan resolves 20 new resources with no replacements or deletions. Native
family creation and replay checks pass. Focused deployment guard, model and
email checks pass; the Worker bundles and the actual Node stack import compile.
The root infrastructure run passed 191 checks and found two expected integration
issues: its old entry-file assertion and the new source files not yet staged.
The updated 13-check structural suite and the staged architecture check pass.
The final fresh inventory suite passes 52 checks, including full-page R2 refusal.

Deployment and live browser, agent and email results will be recorded after the
checks complete. A provider submission alone is not inbox delivery proof.
