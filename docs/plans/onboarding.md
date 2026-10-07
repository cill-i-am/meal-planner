# Onboarding implementation and remaining acceptance

Status: active
Owner: auth and family feature slices
Delivery: remaining product and environment acceptance after saved-resource setup

## Implemented foundation

Auth, recovery, manual family setup, people, and invitations use the
[saved-resource family API](../reference/family-api.md). Naming a family creates
its canonical resource. People and completion update saved resources; reload
reads those resources.

Manual resource forms and their exact submitted commands stay in mounted memory
under the [manual recovery rule](../reference/family-api.md#manual-browser-recovery).
Conversational setup separately retains an accepted action across reload for
explicit retry, as described by the [family setup contract](../reference/features/auth-family/family-setup.md).
Feature hooks own mutation lifecycle and invalidation. Screens own drafts and
navigation. Server receipts, version checks and explicit recovery keep their
existing protections. A lost response does not prove rejection or permit changing
a retained request's identity.

Adult/Child selection is independent of account access. Adults can be added
without an email or invitation. **Invite them to join** is optional; **Add and
invite** coordinates person creation and invitation without recreating a person
when only the invitation stage needs recovery. A child has a managed profile and
no account. One-person families can complete setup.

Recipient invitation pages include join, decline, wrong-account, unavailable and
unfinished-linking states. The roster exposes declined status. Password request,
new-password, invalid-link and confirmed-success screens exist. Production mail
uses the gated Cloudflare adapter; test mail is captured locally. Neither a reset
request nor a provider submission proves inbox delivery.

## Remaining acceptance

Keep the original gap IDs for design cross-references. Current contracts and
observable proof live in the [auth/family feature map](../reference/features/auth-family/README.md)
and [form reference](../reference/forms.md), rather than a second specification.

| ID | Current state and remaining work |
| --- | --- |
| G01 · Auth error identity | Safe typed errors and retry timing are implemented across the reference journey. Verify affected endpoint mappings when behavior changes. |
| G02 · Input validation | The reference forms use TanStack Form, Effect Schema and linked shadcn errors. Keep their actual schemas and decode-on-submit boundary. |
| G03 · Add and invite | Optional adult invitations and partial-stage recovery are implemented. Preserve the original creation/invitation commands while mounted. |
| G04 · Invitation delivery | Adapter and association-before-send recovery are implemented. E2E inbox and link journeys passed on 30 September 2026. Production activation and production inbox/link verification remain open; follow [email operations](../how-to/operate-infrastructure.md#transactional-email). |
| G05 · Invitation decline | Recipient decline and safe roster projection exist, including `invitation_declined`. This is no longer a missing enum or recipient route. |
| G06 · Invitation error transport | Typed person/invitation failures and unknown-result recovery exist. Verify permitted correction and retry outcomes through the feature map when changing this boundary. |
| G07 · Recovery delivery and completion | Screens, reset callback and single-use token handling exist. Disabled delivery remains a supported unavailable state. Production activation and the production mailbox journey remain unverified. E2E receipt and reset-link completion passed on 30 September 2026. |
| G08 · Family creation recovery | Saved-resource creation and replay receipts replace checkpointed slugs. Native and browser tests cover a response lost after commit. |
| G09 · Session and setup resume | Login continuation and reload resolve canonical saved resources. Manual commands retain exact identity while mounted; reload reads saved resources. Chat restores its accepted action for explicit retry and never replays it automatically. |
| G10 · Creator and recipient linking | Creation coordinates creator linking; invitation recovery completes the existing person link. Preserve partial results and the one-person completion path. |
| G11 · Portions and DOB | Appetite-based portion defaults and meal-specific overrides remain outside auth/setup. [PDR-0004](../decisions/pdr-0004-meal-content-portions-recipes-and-shopping.md) owns the model. Do not infer portions from person type or add DOB. |
| G12 · Components and accessibility | The journey uses shadcn, semantic tokens, focus/error behavior and responsive overlays. Automated keyboard/axe checks and mobile WebKit do not prove a physical-device keyboard or full VoiceOver audit. Those checks remain open. |
| G13 · Verification-dependent policy | Do not enable a verification action or claim mailbox ownership from syntax validation. Any changed verification policy needs the corresponding delivery and invitation journey evidence. |
| G14 · Roster status | Pending, declined and linked states come from authoritative association/invitation data. A pending record does not prove mail delivery; distinguish provider submission from receipt. |

The plan remains active for these unmet acceptance items, not for repeating
implemented screens. Live model quality, human ratings and external-beta acceptance
belong to [private discovery](private-discovery/README.md) and
[beta readiness](beta-readiness.md).

## Design and recorded verification

The September 20–22 Paper reviews established the centered forms, framed shadcn
cards, pastel theme, segmented person control, 44px actions, explicit focus/error
states and responsive dialog/drawer treatment. Keep the
[live Paper design](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0)
and [design brief](../../apps/web/.impeccable/onboarding-shape.md) for visual work.
The earlier save-and-resume behavior was replaced by the saved-resource decisions;
its historical checkpoint test counts are not evidence for the replacement.

[PR #254](https://github.com/cill-i-am/meal-planner/pull/254) records the saved-resource
refactor. [PR #257](https://github.com/cill-i-am/meal-planner/pull/257) adds the
native browser suite; [PR #259](https://github.com/cill-i-am/meal-planner/pull/259)
adds concurrency and mobile accessibility checks.
The [local-development guide](../how-to/local-development.md) describes the
repeatable integrated suite, including auth/family, food-profile and synthetic
private-review journeys. These fixtures establish mechanics, not real email
receipt, model quality or external-beta acceptance. No new application test or
production operation is claimed by this documentation cleanup.
