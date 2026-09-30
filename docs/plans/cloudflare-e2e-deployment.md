# Cloudflare E2E deployment

Status: done
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

This E2E stage is deployed. Use its existing D1 target for later releases:

```sh
ALCHEMY_PROFILE=ceird-admin-global pnpm d1:preflight inspect \
  --target .alchemy/e2e/target.json --stage e2e --profile ceird-admin-global
```

Review the returned digest, then pass the same target to `pnpm alchemy:deploy`
with `--stage e2e --profile ceird-admin-global --d1-target
.alchemy/e2e/target.json --d1-evidence <digest>`. Set `ALCHEMY_TUI=1` in a terminal
to inspect and approve the plan. The wrapper rejects `--yes` and rechecks the
release, database identities, migration ledger and schema before deployment.

If the ignored target file is unavailable, use `pnpm d1:preflight discover` to
rebuild it from the deployed API bindings. Fresh-deployment evidence is only for
an empty stage. Do not reuse it for this environment.

## Live verification — 30 September 2026

The final application release is `adb51c59c27323e13e93e53b52d76c62d5e37da2`.
Its guarded apply updated only the Website Worker and completed successfully.

| Flow | Observed result |
| --- | --- |
| Infrastructure | All 20 stack resources deployed; HTTPS works at `e2e.ceird.app`. Existing resources and D1 identities survived each repair release. |
| Provider | The E2E gateway requires authentication, disables payload logs, and returned a completed GPT-6 Luna response using its scoped token. |
| Account | Signup, login, session reload and anonymous account lookup work against the deployed API. |
| Family agent | Luna used the account name and proposed two adults and a child. Explicit confirmation created the family and its saved roster. |
| Shared food conversation | Streaming replies and illustrated question cards work. Answer buttons continue the conversation. |
| Private discovery | Luna returned profile proposals. Confirming one preference published it to the household profile; other proposals stayed private and required review against the new profile version. |
| Weekly planning | A seven-day draft covers four managed occasions for three people. The agent produced a reviewable proposal with daily breakfasts for the reviewed person and Friday takeaway for all three. Applying it updated the calendar and survived reload. The deliberately unresolved meals remain visible and block approval. |
| Food book | An assembled test meal and a takeaway option saved successfully. On the final release, the Add meal form stayed open until its own save succeeded, then closed and displayed the saved option. |
| Reset email | Received in the inbox with SPF, DKIM and DMARC passing. Its link changed the password, revoked the old session, and allowed login with the new password. Reusing the link showed the invalid-link state. |
| Invitation email | Received in the intended mailbox. Signup returned to the invitation; acceptance linked the recipient to the existing adult. After the final release, Continue opened the correct family workspace at `/` without a search-validation error. |
| Responsive signup | No horizontal overflow at 1280px desktop or 390px mobile width. |

These checks used a synthetic family and mailbox aliases controlled by the user.
The planning test proves proposal review and persistence; it is not a completed
real household meal plan. Recipe-import, every swap/leftover combination, and
full plan approval were not exercised in this deployment smoke test. No
credentials, reset tokens or invitation action URLs are recorded here.

Focused tests cover the deployment guards, generated Worker exports, immutable
SSE conversion, invitation callback context, native acceptance/linking, and
strict workspace redirects. A delayed-save browser regression verifies that a
managed-meals save cannot close or discard a new meal form. Relevant API,
infrastructure and web type checks,
lint, formatting and documentation checks passed. This work remains on the
feature branch; it was not merged or pushed.

## Deployment repairs and recovery

The initial apply created the Website, databases, gateways, mail domain, queues
and R2 bucket before failing to upload the API. The repairs retain the same
resource identities:

- Worker entry-file URLs resolve only during planning through Alchemy's
  compile-time runtime flag. The pinned Alchemy patch explicitly retains the
  native `AgentConversation` export beside generated Effect exports, with a
  regression against the final bundle entry.
- The API captures Alchemy's binding context during construction and provides
  it to its request handler. The invitation verifier captures the request's
  Effect context before Better Auth enters its Promise callback.
- Ordinary native responses use Effect's streaming `fromWeb` conversion so
  immutable Cloudflare headers are copied. WebSocket upgrades preserve their
  original response.
- The first container upload failed locally with `spawn EBADF`. A new deploy
  process reused the cached amd64 image and completed its upload and creation.
- The sending domain is enabled, its SPF/DKIM/DMARC records are present, Email
  preview is disabled, and the API delivery gate is enabled. No subscription
  changes were made.

A partial first apply can use `resume-inspect --target <frozen-target>` followed
by `alchemy:deploy --resume-target <frozen-target> --resume-evidence <digest>`.
That path requires the owned API `creating` stub, matching immutable Worker ID,
no final D1 bindings, no replacement state or completed stage output, and the
normal D1 identity, ledger, schema and recovery checks. This completed environment
uses the normal existing-target path instead.
