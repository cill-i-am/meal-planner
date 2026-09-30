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
  account-owned token restricted to Workers AI inference. The gateway enables
  authentication, which Cloudflare Unified Billing requires.
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

The E2E gateway now has authentication enabled and payload logging disabled.
A live request through its own scoped token returned HTTP 200 from
`openai/gpt-6-luna`, with a completed response. This verifies provider access;
the application conversation still needs browser verification.

## First apply and recovery

The first apply created the Website, D1 databases, mail domain, gateways, scoped
inference token, queues and R2 bucket. API Workers remained at Alchemy's
precreated stubs. The private Worker's nested Effect entry-file setting was
absent from saved props; it now uses a direct entry URL. The corresponding
structural check covers that declaration.

An inference A/B check confirmed the same scoped token and Luna request return
HTTP 200 through an authenticated gateway and HTTP 403 through the new gateway
without authentication. The agent gateway now sets `authentication: true`.

The mail domain is enabled and its full-message previews are verified off.
Delivery remains gated until the working API is deployed.

The first container upload failed with a local `spawn EBADF` error after its
build completed. A new deploy process reused the cached amd64 image, uploaded
it successfully and created the container application. The resumed apply also
created the household and private-output Workers. Cloudflare then rejected the
API upload because its generated bundle omitted the native `AgentConversation`
export. The pinned Alchemy patch now supports explicit native exports alongside
its generated Effect exports. The API opts in for `AgentConversation`; a bundle
regression checks that it and `ImportMediaAcquisitionObject` both appear in the
final entry. Commit `dd083c0` deployed all 20 resources successfully, including
the API, both consumers, workflows and container.

The first live account request then exposed a cold-start error in API props:
source-file URL resolution was running inside Cloudflare. These entry URLs now
use Alchemy's compile-time runtime flag so only deployment resolves local files.
The signup layout also now fits 1280px desktop and 390px mobile viewports without
horizontal overflow, verified on the deployed Website.

The API also captures Alchemy's binding context during construction and provides
it to its request handler. The runtime bridge supplies request scope and execution
context per event; it does not supply that binding context to the handler.

Live verification after `819b23c`: anonymous account lookup returned HTTP 200,
signup succeeded, and Luna saved a three-person family proposal using the account
name. The browser stream exposed immutable response headers; ordinary native
responses now use Effect's streaming `fromWeb` conversion, while WebSocket
upgrades preserve the original response.

The password-reset email arrived in the test recipient's inbox on 30 September
2026 with SPF, DKIM and DMARC passing. Its link completed a password reset, revoked
the previous browser session, and the new password successfully logged in. No
reset token or action URL is retained in this record.

The invitation email also arrived. Signup preserved its return destination, but
the final join exposed a missing Worker environment in Better Auth's Promise
callback. The verifier now captures the request's Effect context before entering
that callback; it retains the original invitation and response identity for retry.
The shared agent stream and illustrated food-question buttons work after the
native response conversion fix.

After the callback fix, the recipient linked successfully and could open the
correct family workspace. The return navigation then exposed an obsolete
`familyId` search parameter on `/`. Joined invitations and completed setup now
use the workspace's strict search contract; in-progress setup keeps its family
parameter. Seven focused browser tests cover this redirect and invitation flow.

Private discovery returned profile proposals through Luna. Confirming one
preference saved it to the household profile; other proposals remained private
and required review against the new profile version. A one-week draft was also
created with all four managed occasions for three people.

A partial first apply uses `resume-inspect --target <frozen-target>` followed by
`alchemy:deploy --resume-target <frozen-target> --resume-evidence <digest>`, with
explicit stage and profile. This path requires the API's owned `creating` stub,
matching immutable Worker ID, no final D1 bindings, no replacement state or
completed stage output, and the existing D1 identity, ledger, schema and recovery
checks. It preserves the current resource IDs. Completed environments use the
normal existing-target deployment path.
