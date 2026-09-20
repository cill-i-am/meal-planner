# Onboarding implementation gaps

Updated 2026-09-20 during the Paper review. This is the running implementation checklist; designs are not evidence that the behavior is implemented. Application coding still awaits agreement on the Paper design.

Design: [Login and household setup in Paper](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0). Error and validation specification: [onboarding-error-contract.md](onboarding-error-contract.md).

## Decisions from this review

- Use shadcn as the component base and retain TanStack Form plus Effect Schema.
- Adding an adult must collect their email and invite them in the same user action. The recipient can join or decline. This supersedes the earlier separate, optional invitation step. Adding a dependant creates a managed profile without an account invitation.
- Include field validation and service failure states across the journey, grounded in Better Auth 1.7.2 and household API errors.
- DOB was investigated, not approved as a new field. Recommendation: do not request DOB for portion sizing. The accepted portion model uses appetite-based defaults. The portion capability itself is still missing from code.

## Open gaps

| ID | Current evidence | Required implementation / acceptance | Status |
| --- | --- | --- | --- |
| G01 · Auth error identity | `src/features/auth/auth-client.ts` decodes only `message` and throws a plain Error, losing code, status and retry timing. | Preserve a typed safe error boundary; map endpoint + code + status to field/form/route states. Handle 429 using Better Auth 1.7.2's `X-Retry-After`; unknown errors use safe fallback copy. Do not display raw server messages. | Open |
| G02 · Input validation | `auth-boundary.tsx` has browser required/email/minLength but no TanStack validators, onBlur binding or inline field errors. | shadcn Field, FieldLabel, FieldDescription, FieldError; aria-invalid and describedby; Effect Standard Schema for validation and submit decoding. Blur/submit feedback, then revalidate corrections on change. Login requires a password without reapplying new-password length rules. | Open |
| G03 · Add and invite | `CreateHouseholdPersonPayload` and `InviteHouseholdAdultPayload` are separate in `packages/household-api/src/people.ts`. | One visible Add and invite action. Coordinate both commands, retain the created person ID and exact invitation intent, and recover the failed stage without creating another person or invitation. Preserve form values. | Open |
| G04 · Invitation delivery | `apps/api/src/features/auth/auth.ts` configures organization without `sendInvitationEmail`. Creating an invitation record is not email delivery. | Configure actual invitation delivery and distinguish sending, invitation pending, delivery failed and joined. Design copy “Invitation sent” requires delivery evidence. No email was sent during design work. | Open |
| G05 · Invitation decline | Better Auth exposes rejectInvitation; household association enum has unlinked/invitation_pending/linked/departure_pending/detached, no declined projection. | Wire recipient decline and reconcile the canonical household association. Refresh sender status without inventing membership or deleting the person. Cover already processed, expired, wrong-recipient and failed rejection cases. | Open |
| G06 · Invitation error transport | `household-people.control-plane.ts` wraps all createInvitation failures as unavailable. | Preserve safe actionable upstream distinctions such as invalid email, already invited/member, permission and limits through the household endpoint. Keep ambiguous outcomes distinct from definitive rejection. | Open |
| G07 · Recovery delivery and completion | Auth config only sets emailAndPassword.enabled; no sendResetPassword. Better Auth currently returns RESET_PASSWORD_DISABLED. | Configure delivery, request/sent/new-password/completed/expired-token screens and safe generic request confirmation. Hide or mark recovery unavailable until wired; never pretend an email was sent. | Open |
| G08 · Household creation recovery | `auth-boundary.tsx` creates a random slug at submit time and has no retained creation command or unknown-outcome reconciliation. | Retain the exact creation identity across retry. Check whether the original operation committed before another create. Do not match solely by household display name. Handle session failure after creation as a possible partial success. | Open |
| G09 · Session and setup resume | Current auth boundary chooses auth/household surfaces; the proposed wizard and Save & exit behavior are not implemented. | Save an authenticated checkpoint before showing Setup saved. Retain the pending step and exact command identity; resume by reconciling canonical state. Include partial invitation, unavailable roster and linking states. Preserve safe drafts and intended auth/invitation continuation, resolve an active person draft before continuing, and never persist passwords or reset tokens in browser storage. A failed checkpoint save stays on the origin with a save error. | Open |
| G10 · Creator bootstrap and final linking | Household/person bootstrap and invitation acceptance/person linking cross separate boundaries. | Retain exact mutation IDs and make partial completion visible. Resume linking rather than creating a second profile or re-accepting a settled invitation. One-person households must continue successfully. | Open |
| G11 · Portions and DOB | Person payload, SQL registry and ProfileFactValue have no DOB, age or serving-factor field. Profile facts currently cover food preferences and hard constraints. PDR-0004 defines half 0.5 / small 0.75 / standard 1 / large 1.25 portions per person and occasion. | Implement appetite-based portion defaults in the appropriate discovery/profile work, including explicit confirmation and meal-specific overrides. Do not derive portions from adult/dependant type. No DOB requirement follows from current code or accepted product decision. | Open; outside auth implementation |
| G12 · shadcn adoption and accessibility | Existing UI wrappers are prototype components. Paper shapes are not installed shadcn components. | Adopt/theme the actual primitives; retain keyboard/focus/error associations, 44px targets, password visibility, autocomplete, reduced motion and narrow viewport scrolling. Verify browser behavior when coding. | Open |
| G13 · Verification-dependent failures | Login verification is not required by current config. Better Auth invitation verification policies and list-user-invitations can require verified email; verification delivery is absent. | Classify configured versus conditional failures. Do not show a working resend-verification CTA without delivery. Recheck policy for the final invitation entry route and deterministic invitation IDs. | Open |
| G14 · Pending roster status | The roster currently exposes invitation_pending, not email-delivery success or recipient decline. | Extend the safe projection or join appropriate authoritative status for Pending, Declined, Delivery failed and Joined. Do not infer sent/declined from invitation_pending alone. | Open |

## Critique follow-up — 20 September 2026

The [independent design and shadcn review](onboarding-critique-2026-09-20.md) was approved for a Paper experiment. The [revised design](experiments/compact-themed-shadcn.md) uses shadcn structure and semantic tokens with the original branded theme and segmented control. Product copy uses family. All implementation gaps remain open.

- G12: define the shadcn semantic mapping, bind the largely unused type/spacing tokens, strengthen normal field and selected-control boundaries, and specify focus plus 44px secondary hit areas.
- G03/G13: retain safe account and invitation destination context in wrong-account and partial-invitation recovery.
- G07: the user explicitly removed help copy. The reset-unavailable state explains the limitation and offers a way back without asking users to retry a forgotten password. Configured reset delivery/completion remains necessary before relying on this route for beta account recovery.
- People copy: reconcile Adult/Dependant with what users are choosing; do not label a managed profile Child without explicit evidence. No DOB requirement follows from this finding.
- Presentation: the experiment uses 36px desktop / 28px mobile routine headings, 44px controls, 14px desktop / 16px mobile input text, and the original pill/segmented visual treatment. Component-state references now cover focus, invalid, disabled and loading behavior for implementation.

## Independent critique round 2 — 20 September 2026

The [second critique](onboarding-critique-round2-2026-09-20.md) supports the current themed style and sizing. The user approved all five fixes and Save & exit with pending-step resumption. These findings are now addressed in Paper and its reference contract; all G01–G14 implementation gaps remain open.

- G12 / R2-01: Paper now has a solid ring-colored segment edge. The explicit theme focus rule follows the selected-border rule; a Tailwind 4.3.3 compile confirmed this cascade ordering.
- G02/G12 / R2-02–03: removed branch-specific help from the empty choice in both sizes. The theme now defines the group invalid modifier; the labelled group, linked FieldError and focus behavior are specified in [onboarding-transitions.md](onboarding-transitions.md).
- G07 / R2-04: added paired check-email, ordinary new-password and password-updated screens and their destinations. Recovery remains proposed until delivery exists; Get help remains removed.
- G09/G10 / R2-05: all three exceptional states now offer Save & exit in both sizes. A shared Setup saved state names the pending step and offers Resume setup / Log out. The transition contract requires a durable checkpoint and reconciliation of the original operation.
- Minor affordance: Create an account uses the blue link treatment throughout the login states.

## Evidence anchors

- Versions: `apps/web/package.json`: Better Auth 1.7.2, TanStack Form 1.33.5; confirmed against lockfile and the installed 1.7.2 package in the main checkout.
- Auth configuration: `apps/api/src/features/auth/auth.ts`.
- Account forms and current error adapter: `apps/web/src/features/auth/auth-boundary.tsx`, `auth-client.ts`.
- Person fields, invitations, failures: `packages/household-api/src/people.ts`, `people-http.ts`.
- Stored person fields: `apps/api/src/features/households/household.database-schema.ts`.
- Invitation orchestration: `apps/api/src/features/households/household-request-composition.ts` inviteAdult, and `people/household-people.control-plane.ts`.
- Profile capabilities: `packages/household-api/src/profiles.ts`.
- Portion authority: `docs/decisions/product/0004-meal-content-portions-recipes-and-shopping.md`, Portion model.
- [shadcn TanStack Form guide](https://ui.shadcn.com/docs/forms/tanstack-form) and project `.agents/skills/app-forms/references/tanstack-form-effect-schema.md`.
- Installed Better Auth `dist/api/routes/{sign-in,sign-up,password}.mjs`, `dist/plugins/organization/routes/{crud-org,crud-invites}.mjs` and `dist/api/rate-limiter/index.mjs` were read directly.

## Verification boundary

The pastel gradient is restored in Paper. [The motion study](reference/onboarding-motion.md) demonstrates its proposed 42-second drift, focus/offscreen pause, and reduced-motion behavior. G12 includes integrating that decorative layer into the real app shell, pausing it when hidden, and checking performance on target devices. The reference preview does not close G12.

Research and Paper review only. No application behavior, schema, auth configuration, email delivery or production data has been changed. Each gap remains open until implementation and relevant behavior checks demonstrate it is closed.
