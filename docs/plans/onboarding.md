# Onboarding implementation gaps

Status: active
Owner: onboarding implementation in the current stacked branches
Delivery: auth, household, people, invitations and recovery screens are being validated together; email delivery remains mocked
Updated 2026-09-23 after the stacked-PR review. This is the running implementation checklist; designs are not evidence that the behavior is implemented. The dated design agreements below do not establish completed application work. Reuse agreements already obtained when implementation is assigned.

Design: [Login and household setup in Paper](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0). Error and validation specification: [onboarding-error-contract.md](../../apps/web/.impeccable/onboarding-error-contract.md).

## Review follow-up · 23 September 2026

Setup progress now has one server-owned, versioned save command. Competing tabs cannot replace a pending request, and completing one requires its original command ID. Draft forms and overlay visibility stay in React; roster queries only read, while the setup boundary selects the active family. Invitation acceptance and decline now make mutually exclusive D1 transitions. An acceptance that failed under an expired session no longer blocks a fresh session from trying again. Adults with declined or unavailable invitations can be invited again using the same person profile; the old association is retired atomically. The responsive overlay keeps its active primitive mounted through its close transition. The member-departure workflow maps failed D1 membership reads to an unavailable observation so it can enter repair.

These changes are under local and stacked-PR verification. Email delivery remains mocked. The PR containing the Alchemy Better Auth migration also contains later onboarding and UI work; split that work into its own stacked PR before review.

## Roster management and responsive overlays · 22 September 2026

Follow-up: roster dialog visibility and unsubmitted drafts now live in local UI
state. Opening or cancelling a dialog no longer writes a checkpoint or waits for
a session refresh. The server checkpoint contains only a submitted command;
unknown results keep their original request identity. Motion for React now
animates the existing Base UI dialogs, selection indicator, reveals and icon
changes. Base UI retains focus, dismissal and native drawer behavior. LiveStore remains a
[future research option](../research/2026-09-22-livestore-local-first-sync.md),
not an adopted dependency.

Follow-up validation: 221 web tests and 31 household contract tests passed,
along with web/API typechecks, repository lint and the production web build.
Browser checks confirmed zero API requests on Invite open/cancel, retained email
across desktop/mobile changes, animated collapse, reduced motion and no console
errors. A second review checked pending-request recovery, including a late
response arriving after another pending command was observed.

The user approved [roster actions and mobile bottom sheets](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-D-0).
Use current shadcn Base UI Drawer rather than Vaul, with one shared composition
for desktop dialogs or side drawers and mobile bottom sheets. Keep native
nesting, snap-point and keyboard capabilities available. The earlier mobile
floating-dialog exploration remains in Paper for comparison.

Implemented Invite, Edit name and Remove in the add-person roster and family
review. The flow retains the unfinished form and return location. Removal
cancels a pending invitation or revokes linked family access before archiving
the person. The current user can edit their name but cannot remove themselves
here. Email delivery stays mocked.

The shared `Overlay` switches between desktop dialogs or side drawers and
mobile bottom sheets. Native drawer options retain nesting and snap points;
short roster forms use their content height. See the
[developer examples](../../apps/web/src/components/ui/SHADCN.md#responsive-overlays).

Browser checks covered mobile widths of 320px and 390px, desktop dialogs,
draft preservation across viewport changes, invalid-email focus, rename,
mocked invitation, cancellation and removal, focus restoration, exit animation,
and reduced motion. Native integration tests cover authorization, accepted
invitation races, overlapping cancellation, and replay after profile restoration.
The keyboard provider is wired, but an actual mobile on-screen keyboard has
not been tested on a physical device. Earlier Paper explorations remain intact.

Local validation passed: 212 web tests, a final 20-test overlay/roster rerun,
31 auth integration tests, four native removal scenarios, web and API typechecks,
repository lint and formatting, documentation links, the production architecture
inspection, and the production web build. The web suite ran one file at a time
after the parallel run exceeded existing timeouts under local load.

## Auth route delivery — 21 September 2026

The application now has separate `/login`, `/signup`, and `/forgot-password`
routes. The protected workspace redirects anonymous visitors to login with a
validated local return destination. Signup and login refresh session and family
queries before continuing to the existing workspace or family setup.

The login and signup screens use the live Paper Auth page, shadcn Base UI Button
and Input, shadcn Field primitives, self-hosted Inter, and the agreed pastel theme.
Forms validate through Effect Schema and TanStack Form, preserve entered values
on rejection, focus invalid fields, expose password visibility, and prevent
parallel submissions. Better Auth error codes/statuses remain available without
rendering raw server messages. Rate limits honor validated `X-Retry-After`.

- G01 is implemented for login/signup. Other onboarding endpoint mappings remain open.
- G02 is implemented for login/signup. Other onboarding forms remain open.
- G07 has a working reset-unavailable route. Email delivery and the configured recovery journey remain open.
- G12 is implemented for auth, including 44px controls, accessible errors, mobile scrolling, and reduced-motion/focus/visibility pause. Other onboarding screens remain open.

Verification: 159 web tests and the production build passed. A disposable local
Miniflare D1 database with the real Better Auth configuration verified signup,
invalid credentials, login, logout, and the family-setup destination. Browser
checks cover desktop/mobile layout and keyboard/error states. This does not
claim deployment, email delivery, or completion of the wider family setup design.

## Framed shadcn direction — 21 September 2026

The user approved the framed card and soft-depth direction after the Stripe and
coss references. The [independent Impeccable review](../../apps/web/.impeccable/critique/2026-09-21T21-02-50Z__ign-file-01m2yngss3qw4t1envyss0zxnp-p-7-0-ebc73719.md)
supported it and identified mobile width, target sizing and component-reference
consistency corrections.

Auth now composes shadcn Card sections, white inputs and a password eye
toggle. Shared shadcn buttons use coss-inspired depth for primary, secondary, outline and
destructive variants; links and ghost actions stay flat. Account-switch navigation
moves into the muted footer. shadcn remains the component foundation, with TanStack Form, Effect validation
and current auth routes retained. Other libraries inform styling without replacing
component APIs.

All 62 desktop/mobile screens and states in Paper Auth, Household, People,
Invitations and Recovery adopt the new direction. Dense mobile setup uses 16px
inner padding; supporting people lists remain after form actions. The Overview
records the component variants and state treatment. Existing behavioral gaps above
remain open; updating a design does not implement household or recovery delivery.
Historical screenshots remain labelled as the earlier baseline.

Local verification passed: 159 web tests, TypeScript, production build, focused
lint and the documentation check. Browser checks covered desktop login, mobile
signup at 320px and 390px, validation, password visibility and 44px controls.
The final signup accessibility scan reported no violations. CI and PR review
remain deferred at the user's request.

## Better UI polish — 21 September 2026

Applied the [better-ui review](../../apps/web/.impeccable/better-ui-review-2026-09-21.md)
to the shared shadcn card, button, tooltip and password-icon components. Cards use
layered neutral shadow edges; buttons have explicit transitions and restrained
press feedback; password icons cross-fade with an immediate reduced-motion state.
The recovery heading now follows the agreed line height.

All 62 canonical Paper onboarding screens/states use the matching surface edge.
Password icons and the Overview motion guidance match the implementation. This
polish does not close the behavioral gaps below. Local tests, TypeScript, focused
lint and the production build passed. The review records browser checks and the
unavailable 10% motion playback check. CI and PR work remain deferred.

## Decisions from this review

- Use shadcn as the component base and retain TanStack Form plus Effect Schema.
- Adding an adult must collect their email and invite them in the same user action. The recipient can join or decline. This supersedes the earlier separate, optional invitation step. Adding a dependant creates a managed profile without an account invitation.
- Include field validation and service failure states across the journey, grounded in Better Auth 1.7.2 and household API errors.
- DOB was investigated, not approved as a new field. Recommendation: do not request DOB for portion sizing. The accepted portion model uses appetite-based defaults. The portion capability itself is still missing from code.

Paths beginning `src/` in the table are relative to `apps/web/`; other source
paths are relative to the repository root.

## Open gaps

| ID | Current evidence | Required implementation / acceptance | Status |
| --- | --- | --- | --- |
| G01 · Auth error identity | `auth-client.ts` now preserves safe codes/status and login/signup retry timing; the auth routes map these to safe field/form errors. Other onboarding mappings remain incomplete. | Preserve safe typed errors and map endpoint + code + status to field, form, or route errors. For 429, use Better Auth 1.7.2's `X-Retry-After`. Use safe fallback text for unknown errors; never show raw server messages. | Partial — auth implemented |
| G02 · Input validation | Login/signup now use Effect and TanStack validation with linked shadcn field errors. The existing household form still uses browser validation. | Use shadcn Field, FieldLabel, FieldDescription, and FieldError with aria-invalid and describedby. Use Effect Standard Schema for validation and decode on submit. Show errors on blur/submit, then recheck corrections on change. Login needs a password but must not apply new-password length rules. | Partial — auth implemented |
| G03 · Add and invite | `CreateHouseholdPersonPayload` and `InviteHouseholdAdultPayload` are separate in `packages/household-api/src/people.ts`. | Offer one Add and invite action. Coordinate both commands and save the created person ID and exact invitation request. If one step fails, retry that step without creating another person or invitation. Keep entered form values. | Open |
| G04 · Invitation delivery | `apps/api/src/features/auth/auth.ts` configures organization without `sendInvitationEmail`. Creating an invitation record is not email delivery. | Implement email delivery. Distinguish sending, invitation pending, delivery failed, and joined. Show “Invitation sent” only with delivery evidence. Design work sent no email. | Open |
| G05 · Invitation decline | Better Auth exposes rejectInvitation; household association enum has unlinked/invitation_pending/linked/departure_pending/detached, no declined projection. | Connect recipient decline to the actual invitation and update the household association. Refresh the sender's status without inventing membership or deleting the person. Handle processed/expired invitations, wrong recipients, and failed declines. | Open |
| G06 · Invitation error transport | `household-people.control-plane.ts` wraps all createInvitation failures as unavailable. | Return safe, useful errors for invalid email, already invited/member, permissions, and limits through the household endpoint. Keep an unknown result distinct from a definite rejection. | Open |
| G07 · Recovery delivery and completion | Auth config only sets emailAndPassword.enabled; no sendResetPassword. Better Auth currently returns RESET_PASSWORD_DISABLED. | Implement delivery and the request, sent, new-password, completed, and expired-token screens. Keep request confirmation generic and safe. Until delivery works, hide recovery or mark it unavailable. Never claim an email was sent when it was not. | Open |
| G08 · Household creation recovery | The family form now submits one Effect HttpApi command. The server checkpoints its slug and creator mutation ID before creating the Better Auth organization, then reuses that identity when a request is retried. | Verify the canonical family and creator after interruptions. Keep an unknown result distinct from a definite rejection; never create a second logical family for the same saved command. | Partial — command implemented |
| G09 · Session and setup resume | Setup screens now put Log out in the header. The action saves the safe draft and exact pending command before signing out; a failed save leaves the session and draft in place. Submitted commands are checkpointed at dispatch. | Finish validating resumption against canonical state for partial invitations, unavailable rosters and unfinished links. Preserve the intended sign-in/invitation destination; never store passwords or reset tokens in setup progress. | Partial |
| G10 · Creator bootstrap and final linking | Household/person bootstrap and invitation acceptance/person linking cross separate boundaries. | Keep exact mutation IDs and show partial completion. Resume the link rather than create another profile or accept an already-accepted invitation. A one-person household must be able to continue. | Open |
| G11 · Portions and DOB | Person payload, SQL registry and ProfileFactValue have no DOB, age or serving-factor field. Profile facts currently cover food preferences and hard constraints. PDR-0004 defines half 0.5 / small 0.75 / standard 1 / large 1.25 portions per person and occasion. | Add appetite-based portion defaults in discovery/profile work, with explicit confirmation and meal-specific overrides. Do not infer portions from adult/dependant type. Neither the code nor the accepted decision requires DOB. | Open; outside auth implementation |
| G12 · shadcn adoption and accessibility | Auth routes now use installed shadcn Button/Input and Field primitives with the Paper theme. Remaining onboarding surfaces still need migration. | Use and theme the actual shadcn components. Preserve keyboard use, focus, linked errors, 44px targets, password visibility, autocomplete, reduced motion, and narrow-screen scrolling. Check these in the browser during implementation. | Partial — auth implemented |
| G13 · Verification-dependent failures | Login verification is not required by current config. Better Auth invitation verification policies and list-user-invitations can require verified email; verification delivery is absent. | Distinguish errors possible under current settings from those that depend on future settings. Do not offer resend verification before email delivery exists. Check the final invitation entry route and deterministic invitation IDs against the chosen policy. | Open |
| G14 · Pending roster status | The roster currently exposes invitation_pending, not email-delivery success or recipient decline. | Extend the safe roster response, or combine it with the appropriate authoritative status, to show Pending, Declined, Delivery failed, and Joined. `invitation_pending` alone proves neither delivery nor decline. | Open |

## Critique follow-up — 20 September 2026

The [independent design and shadcn review](../../apps/web/.impeccable/onboarding-critique-2026-09-20.md) was approved for a Paper experiment. The [revised design](../../apps/web/.impeccable/experiments/compact-themed-shadcn.md) uses shadcn structure and semantic tokens with the original branded theme and segmented control. Product copy uses family. The dated review left all gaps open; the auth delivery section above records subsequent implementation.

- G12: define the shadcn semantic mapping, bind the largely unused type/spacing tokens, strengthen normal field and selected-control boundaries, and specify focus plus 44px secondary hit areas.
- G03/G13: retain safe account and invitation destination context in wrong-account and partial-invitation recovery.
- G07: the user explicitly removed help copy. The reset-unavailable state explains the limitation and offers a way back without asking users to retry a forgotten password. Configured reset delivery/completion remains necessary before relying on this route for beta account recovery.
- People copy: reconcile Adult/Dependant with what users are choosing; do not label a managed profile Child without explicit evidence. No DOB requirement follows from this finding.
- Presentation: the experiment uses 36px desktop / 28px mobile routine headings, 44px controls, 14px desktop / 16px mobile input text, and the original pill/segmented visual treatment. Component-state references now cover focus, invalid, disabled and loading behavior for implementation.

## Independent critique round 2 — 20 September 2026

The [second critique](../../apps/web/.impeccable/onboarding-critique-round2-2026-09-20.md) supports the themed style and sizing. At that review, the user approved all five fixes and Save & exit with pending-step resumption. The header action was later changed to Log out with a save before sign-out. All G01–G14 gaps were open at that review; see the later delivery notes for implementation evidence.

- G12 / R2-01: Paper now has a solid ring-colored segment edge. The explicit theme focus rule follows the selected-border rule; a Tailwind 4.3.3 compile confirmed this cascade ordering.
- G02/G12 / R2-02–03: removed branch-specific help from the empty choice in both sizes. The theme now defines the group invalid modifier; the labelled group, linked FieldError and focus behavior are specified in [onboarding-transitions.md](../../apps/web/.impeccable/onboarding-transitions.md).
- G07 / R2-04: added paired check-email, ordinary new-password and password-updated screens and their destinations. Recovery remains proposed until delivery exists; Get help remains removed.
- G09/G10 / R2-05: the earlier Paper states offered Save & exit and a Setup saved destination. The current header offers Log out, which saves the draft and exact pending command before signing out. Resume still requires reconciliation of the original operation.
- Minor affordance: Create an account uses the blue link treatment throughout the login states.

## Evidence anchors

- Versions: `apps/web/package.json`: Better Auth 1.7.2, TanStack Form 1.33.5; confirmed against lockfile and the installed 1.7.2 package in the main checkout.
- Auth configuration: `apps/api/src/features/auth/auth.ts`.
- Account forms and current error adapter: `apps/web/src/features/auth/auth-boundary.tsx`, `auth-client.ts`.
- Person fields, invitations, failures: `packages/household-api/src/people.ts`, `people-http.ts`.
- Stored person fields: `apps/api/src/features/households/household.database-schema.ts`.
- Invitation orchestration: `apps/api/src/features/households/household-request-composition.ts` inviteAdult, and `people/household-people.control-plane.ts`.
- Profile capabilities: `packages/household-api/src/profiles.ts`.
- Portion authority: `docs/decisions/pdr-0004-meal-content-portions-recipes-and-shopping.md`, Portion model.
- [shadcn TanStack Form guide](https://ui.shadcn.com/docs/forms/tanstack-form) and project `docs/how-to/build-a-form.md`.
- Installed Better Auth `dist/api/routes/{sign-in,sign-up,password}.mjs`, `dist/plugins/organization/routes/{crud-org,crud-invites}.mjs` and `dist/api/rate-limiter/index.mjs` were read directly.

## Verification boundary

The pastel gradient is restored in Paper. [The motion study](../../apps/web/.impeccable/reference/onboarding-motion.md) demonstrates its proposed 42-second drift, focus/offscreen pause, and reduced-motion behavior. G12 includes integrating that decorative layer into the real app shell, pausing it when hidden, and checking performance on target devices. The reference preview does not close G12.

The 20 September evidence records design review only. The auth delivery section records the later application implementation and verification; no email delivery or production data changes are claimed.

## Household stack layer — 22 September 2026

Household setup now uses `/setup/family`, `/setup/review`, `/setup/ready` and
`/setup/saved`. Better Auth stores a validated account-owned checkpoint in D1.
Creation records its exact slug and creator command before sending either write;
retry reconciles the existing family and linked creator. Pause/resume preserves
the current step. Fresh sessions restore and authorize the completed family.
Requests bind their expected account and family to prevent another tab from
redirecting an in-flight operation. These expectations never grant membership.

The shared TanStack form hook moved to `components/forms/form.tsx`. Screens retain
shadcn composition, Tailwind, OKLCH tokens and Paper's routine/completion typography.
Two independent Impeccable assessments identified recovery copy, logout ownership,
completion hierarchy and session-scoping issues; these were corrected. The engine
scanner was unavailable (missing cached engine; release download failed), so the
review used live Browser/Paper and source inspection. No automated scan pass is
claimed. Review score before corrections: 28/40.

Local verification: 161 web tests, checkpoint-schema tests, five D1 auth tests,
TypeScript, focused lint and production build. Browser exercised real family
creation/reconciliation, pause/resume and the review/completion screens. People,
invitations and recovery continue in the next three dependent PRs; email delivery
is not part of this household layer. No deployment or merge is claimed.

## People stack layer — 22 September 2026

`/setup/people` implements the invite-adult and managed-profile forms, validation,
saved drafts and unfinished-invitation recovery. `/setup/edit-person` renames an
existing canonical person with an optimistic version and replay receipt. Review
links to these operations; the supporting roster stays below form actions.

Person creation and invitation use separate retained mutation identities. A lost
result retries the same operation. Definitive invitation rejection preserves the
person and offers email correction or family review. Better Auth's invitation row
binds its recipient, originating inviter and household person before association;
changed retries cannot bind an existing invitation to another person. Account and
edit identity key mounted state, and commands retain their original targets.

MOCK: `apps/api/src/features/auth/auth-mail.ts` does not send invitation emails.
The callback boundary is injectable for tests; records, membership checks, person
links and all non-email operations remain real. The recipient routes are the next
stack layer.

Validation: 163 web tests; real Durable Object rename/replay/version regression;
real invitation failure/restart and changed-intent tests; D1 auth and typed duplicate
recipient tests; TypeScript, lint and production build. Browser verified managed
profile creation, rename, adult invitation, one field error per invalid input,
save/resume, and duplicate-recipient correction without a duplicate person. The
independent design assessment reached 32/40 after fixes. Local desktop/mobile
screenshots are captured; publishing media still awaits the requested approval.

## Invitations stack layer — 22 September 2026

`/invitation/:invitationId` provides recipient-only details, join/decline,
wrong-account switching, unavailable and declined outcomes, and partial-linking
recovery. `/setup/join` resumes a saved response. The checkpoint preserves the
whole previous setup draft; an unresolved family/person mutation must finish
before responding to a new invitation. Terminal outcomes restore that prior
checkpoint rather than trapping the account in a redirect loop. A decline that
was accepted in another session requires an explicit choice to finish linking.

A private Better Auth read exposes closed invitation outcomes only to the invited
account, so a lost acceptance or decline response can be reconciled. The original
profile-link mutation survives pause/restart. Sender status matches the exact
Durable Object invitation association; unrelated invitation records cannot mask
a decline. The private association digest is never returned in the public roster.

The two independent reviews identified command preservation, terminal-state
recovery, account-switch redirects, long-address wrapping, cross-session response
conflicts and link composition. These were corrected. Browser verified anonymous
invitation entry, wrong-account switching, actual recipient acceptance/linking,
decline, and mobile wrapping. Unit/UI tests exercise lost responses, restored
drafts and the deliberate cross-session linking choice. Native boundary tests
cover exact invitation status projection and returning former members.

## Recovery stack layer — 22 September 2026

`/forgot-password` now implements request and check-email states;
`/reset-password` implements new-password, invalid-link and confirmed-success
states. They use the same shadcn card, form fields, password visibility tooltips,
Tailwind classes and semantic tokens as the other auth screens. The original
local destination survives every recovery link.

MOCK: the password-reset adapter in `auth-mail.ts` deliberately does not deliver
email. Better Auth still creates, expires and consumes real single-use tokens.
Tests capture that callback without logging reset URLs. A configured mail
provider must replace both mock adapters before real email delivery is expected.
Passwords stay in the in-memory form; the consumed URL token and form values are
cleared after confirmed success. Reset revokes existing sessions and does not
sign the account in automatically. Known and unknown email addresses receive the
same confirmation. Rate-limit cooldowns survive input edits.

Local verification across the completed code: 172 web tests; eight real D1 auth
and recovery tests; all 116 household boundary/DO integration tests; API/web TypeScript;
focused lint and production build. Browser checked desktop/mobile request, validation, generic
confirmation, retained email and invalid-link recovery. Actual password changes,
single-use/expired tokens and session revocation were verified in the isolated
D1 tests. Independent design and correctness reviews used live Paper plus source;
no automated Impeccable-engine scan is claimed.

The changes form three dependent People, Invitations and Recovery layers above
Household PR #239, managed through `gh stack`. CI has not been awaited. Local
visual captures are available; automatic approval review blocked GitHub screenshot
upload pending explicit approval of the synthetic fixture media. No deployment or
merge is claimed.

## Better Auth review fixes · 22 September 2026

The follow-up security layer addresses the five implementation review findings:

- Better Auth rate limiting is explicitly enabled with its atomic D1-backed
  counter storage and Cloudflare's authoritative client-IP header.
- Password reset and invitation acceptance retain Better Auth's endpoint
  contracts and validation while committing their related changes in a Drizzle
  D1 batch. An immutable receipt records the original operation and guards every
  write. The existing private-output fence can reconcile these receipt-backed
  operations after an uncertain dispatch; ordinary mutations still require one
  dispatch claim. Membership is unique per organization and user.
- Main-app HTTP and private WebSocket requests carry the account and family
  displayed by the originating view. Identity changes dispose old queries and
  connections; unfinished roster and profile commands remain scoped to their
  original account and family.
- Retained invitation IDs are supplied by the server through Better Auth's
  `beforeCreateInvitation` hook. Core ID fields are no longer redeclared, and
  schema generation preserves the plugin's membership index and receipt table.

Recovery requires another request. A failed dispatched acceptance keeps private
output closed until a valid retry or a retry after cancellation/expiry reconciles
the outcome. There is no automatic background reconciliation. Retained intent
ownership allows reconciliation even after an expired reset token is cleaned up;
revisiting a consumed token does not start a new output invalidation.

The new D1 migrations must be applied with the code before deployment. A unique
membership index intentionally rejects existing duplicate membership rows;
resolve any such records explicitly rather than silently deleting access data.
Email delivery remains mocked as requested. This work configures neither a mail
provider nor mailbox verification and performs no deployment.

Local verification covered 1,152 API tests, 177 web tests, 80 package tests and
180 infrastructure/architecture tests. The full runs exposed shared-IP fixture
throttling and missing D1-consumer registrations; the affected suites and final
architecture acceptance case passed after those fixes. Type checks, production
builds, formatting, lint, documentation and schema-generation drift checks pass.
Browser checks covered setup navigation, loaded household data, sign-out, signup
validation and generic reset confirmation. Private WebSocket behavior was checked
in native integration tests because the local HTTP preview does not proxy upgrades.

## Auth value contracts · 22 September 2026

Auth boundaries now share an `EmailAddress` schema and separate user, invitation,
member, credential-account and verification-record ID brands. The existing
`HouseholdOrganizationId` remains the organization identity. Opaque IDs accept
Better Auth's generated values and server-retained IDs without requiring UUIDs;
empty, oversized, whitespace and control-character values are rejected.

Email syntax uses the installed Zod email pattern inside Effect Schema, with a
254-character limit. Native auth entry points and browser commands use the same
rule. Draft form text may remain incomplete, but submitted commands and persisted
auth projections must decode successfully. This validates syntax, not mailbox
ownership or delivery. The generic auth-resource and invitation-email brands have
been removed, and their callers use the appropriate domain types.

Malformed invitation URLs use the unavailable screen; invalid stored invitation
data produces a generic unavailable response. Runtime validation tests and
compile-time checks cover the shared values and prevent interchanging ID types.

Validation: 1,153 API tests, 184 web tests and 29 household-contract tests pass,
along with workspace type checks, production builds, lint, formatting, docs and
the tracked D1 architecture check. Better Auth schema regeneration has no diff.
Browser checks confirm the unavailable screen for malformed invitation links and
a single field error for invalid recovery emails. The household invitation form
also preserves invalid input and blocks dispatch, covered by a regression test.

## Person type and optional invitations · 22 September 2026

The add-person form separates Adult / Child from account access. Adults can be
added without an email or account; an unchecked invitation choice reveals the
email field only when selected. Children have managed preferences and no account.
Changing person type clears invitation consent. The family list labels unlinked
adults as “Adult” and offers “Invite to join” as a separate action later.

Paper's People screens and validation states include the new choice and matching
desktop/mobile states. Log out retains the draft and invitation choice;
pending creation/invitation commands keep their existing recovery behavior.

Validation: 191 web tests and 29 household-contract tests pass, along with web
type checking, production build, focused lint/formatting and documentation checks.
Local browser checks cover adult creation without email, child creation after an
invitation validation error, and invitation draft resumption after reload. Desktop
and 390px screenshots cover both person types. Email delivery remains mocked.

## Alchemy Better Auth integration · 22 September 2026

Use the official `@alchemy.run/better-auth` package at `2.0.0-beta.76`, matching
Alchemy, with the existing Better Auth and Effect versions. Alchemy owns the
per-request auth instance and background-task lifetime. Session, membership and
household invitation callers use Effect operations. The native CLI/test factory
shares the runtime's configuration rather than duplicating its plugins.

The custom Database layer retains the guarded Drizzle relations-v2 adapter;
`migrate: false` keeps checked-in Drizzle migrations authoritative. Preserve the
current signing secret, identity checks, output fence, atomic reset/invitation
plugins and retained invitation IDs. Email delivery remains mocked. No deployment
or database changes are part of this integration. See the
[auth runtime reference](../reference/household.md#auth-runtime).

Validation: 1,157 API tests pass, including real Workerd/D1 coverage of typed API
errors, account mismatch, failed revocation, background-task draining and concurrent
invitation identities. API and infrastructure type checks, API production build,
formatting, lint, docs and the tracked D1 architecture check pass. Better Auth CLI
schema regeneration has no diff. The local browser retained the existing session,
created a pending invitation, signed out and resumed the saved family after sign-in.
Independent review found no actionable regression. CI has not been awaited.
