# Onboarding errors and validation

Design specification, checked 2026-09-20 against Better Auth **1.7.2**, TanStack Form **1.33.5**, the current auth configuration and household API. This is not implemented behavior. See [implementation gaps](../../../docs/plans/onboarding.md).

## Presentation contract

Use shadcn `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, Input, a single-selection ToggleGroup styled as a segmented control, Button and Alert with TanStack Form. Keep Effect Schema as the validator through Standard Schema, and decode the submitted payload with the owning schema.

Validate on blur and submit; once a field has been visited or submission attempted, revalidate corrections on change. Do not mark untouched fields red on first load. Display a message beside each invalid input, link it with aria-describedby, and set aria-invalid/data-invalid. On submit, focus the first invalid field and announce a form summary when several fields fail. Error text is at least 14px/20px; color is reinforced with words and a border.

Submission failures use an Alert in the form before the action. Invitation/session failures that prevent a form from loading use a full content state with a recovery action. Preserve ordinary inputs. Never persist passwords outside in-memory form state. Password visibility and recovery links remain keyboard accessible. Pending submission has one owner; disable sibling mutations until the outcome is known.

The static Paper error examples illustrate each component/state family. The tables below own the individual code-to-copy variants; every code does not need its own duplicate full-page artboard.

The segmented participation Field applies `aria-invalid` to the labelled ToggleGroup and associates its FieldError through `aria-describedby`. The theme defines the whole-group destructive outline/halo, plus a solid focus edge that wins over the selected border. Do not show either branch’s helper when no value is selected. See [transition and focus rules](onboarding-transitions.md#segmented-participation-field).

## Field rules

| Screen / input | Rule and copy | Evidence / qualification |
| --- | --- | --- |
| Signup · Name | Trim; required: “Enter your name.”; maximum 80: “Use 80 characters or fewer.” | Nonempty name is a proposed UI rule. The 80-character bound aligns with HouseholdPersonDisplayName for creator bootstrap; Better Auth itself does not declare this maximum. |
| Signup · Email | Required: “Enter your email.”; malformed: “Enter a valid email address.” | Better Auth INVALID_EMAIL and endpoint validation. Use type=email, autocomplete=email; server validation remains authoritative. |
| Signup · Password | Required: “Create a password.”; below 8: “Use at least 8 characters.”; above 128: “Use 128 characters or fewer.” | Current Better Auth defaults; do not invent composition rules. autocomplete=new-password. |
| Login · Email | Required / valid email as above. | INVALID_EMAIL. |
| Login · Password | Required: “Enter your password.” | Do not impose signup min/max constraints on login; pinned signInEmail verifies the supplied password. Invalid credentials belong at form level. |
| Household · Name | Trim; required: “Enter a family name.” | Better Auth organization name min(1). Whitespace-only rejection is the proposed UI rule. No arbitrary maximum is claimed as an existing contract. Slug is internal and is not a user input. |
| Person · Name | Trim; required: “Enter their name.”; maximum 80. | HouseholdPersonDisplayName. Do not restrict people to a first name. |
| Person · Type | Invite adult (adult) or Manage profile (dependant); invalid/missing draft: “Choose how they’ll take part.” | HouseholdPersonKind enum. A selected valid default has no initial error. |
| Adult · Email | Required: “Enter an email so we can invite them.”; malformed: “Enter a valid email address.”; maximum 320. | HouseholdInvitationEmail bounds plus Better Auth email validation. Adult creation now includes invitation. |
| Dependant | Name and person type only; no account email or DOB. | Managed profile. Does not imply a portion size. |
| Recovery request · Email | Required / valid email. | Endpoint schema. An unknown account receives the same successful confirmation as a known one after recovery is enabled. |
| New password · Password | Same 8–128 rules as signup. | Better Auth resetPassword. Proposed recovery completion surface. |
| New password · Confirm password | Required; mismatch: “Passwords don’t match.” | UI-only confirmation; send only the new password and token to Better Auth. |

## Better Auth endpoint failures

Use structured codes, not message-string matching. Current frontend and invitation adapter discard information needed for this mapping (G01/G06). Where Better Auth returns only an HTTP status/message, normalize by endpoint and status; do not assume every failure has a code.

| Surface | Source result | User state and action |
| --- | --- | --- |
| Login | INVALID_EMAIL | Email FieldError. |
| Login | INVALID_EMAIL_OR_PASSWORD | “Email or password doesn’t match. Try again or reset your password.” Keep both inputs and Log in. Do not identify whether an account exists. |
| Login | FAILED_TO_CREATE_SESSION | “We couldn’t sign you in. Try again.” Form Alert; retain inputs. |
| Login, conditional config | EMAIL_NOT_VERIFIED | “Verify your email before logging in.” A resend action requires configured verification delivery; currently absent. |
| Login, config failure | EMAIL_PASSWORD_DISABLED | “Email login is temporarily unavailable.” Return later / support route if one exists; no futile repeat submit. |
| Signup | INVALID_EMAIL, INVALID_PASSWORD, PASSWORD_TOO_SHORT, PASSWORD_TOO_LONG | Corresponding email/password FieldError. |
| Signup | USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL | “An account already uses this email. Log in or use another email.” Email FieldError plus Log in action. This is the configured auto-sign-in behavior; verification/autoSignIn settings may change duplicate handling. |
| Signup | FAILED_TO_CREATE_USER | “We couldn’t create your account. Please try again.” Preserve fields, except never store password durably. |
| Signup | FAILED_TO_CREATE_SESSION | “Your account may be ready, but we couldn’t sign you in.” Offer Log in; do not immediately create another account. |
| Signup, config failure | EMAIL_PASSWORD_SIGN_UP_DISABLED | “Account creation is temporarily unavailable.” Keep Log in available. |
| Household create | ORGANIZATION_ALREADY_EXISTS | “We couldn’t finish creating your family.” Internal slug collision; resolve the original creation status and recover without blaming the household name or creating a duplicate. |
| Household create, conditional config | YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION | “You can’t create a family with this account.” Return to an existing household or switch account. |
| Household create, conditional config | YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS | “This account has reached its family limit.” Show existing households; no repeat create. |
| Household load/select | ORGANIZATION_NOT_FOUND | “This family is no longer available.” Refresh available households. |
| Household load/select | USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION | “You no longer have access to this family.” Return to available households / account entry. |
| Add and invite | INVALID_EMAIL | Email FieldError; keep name/type. |
| Add and invite | USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION | “This person already has access to your family.” Review the existing member; never create another person to recover. |
| Add and invite | USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION | “An invitation is already waiting for this email.” Show the existing invitation status after identity verification; no automatic replacement. |
| Add and invite | INVITATION_LIMIT_REACHED | “Your family has too many pending invitations.” Review invitations; retain the person draft/created person. |
| Add and invite | MEMBER_NOT_FOUND, ORGANIZATION_NOT_FOUND | “We couldn’t find your current family access.” Reload membership; do not retry with a guessed household. |
| Add and invite | YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION | “Only the family organiser can invite people.” Show existing roster and retain draft. |
| Add and invite, internal role mismatch | YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE | “We couldn’t send this invitation.” Safe form fallback; implementation always requests member role, with no role picker. |
| Invite accept/reject | INVITATION_NOT_FOUND | “This invitation is no longer available.” It may be expired, cancelled or already handled; ask the organiser for a new invitation. Do not claim expiry alone unless known. |
| Invite accept/reject | YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION | “This invitation is for another email address.” Switch account; do not reveal another recipient's email from an untrusted link. |
| Invite accept/reject, conditional policy | EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION | “Verify your email to respond to this invitation.” Verification action only once delivery is configured. |
| Invite load/list, conditional policy | EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION | Same verification state. List-user-invitations requires verified email in the installed version. |
| Invite accept | ORGANIZATION_MEMBERSHIP_LIMIT_REACHED | “This family has reached its member limit.” Contact organiser; no repeated acceptance. |
| Invite load/accept/reject | ORGANIZATION_NOT_FOUND | “This family is no longer available.” Return to account. |
| Invite load | INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION | “Ask a current family organiser for a new invitation.” |
| Invite load | Code-less 400 “Invitation not found!” | Normalize to invitation unavailable based on endpoint/status. |
| Reject invitation | Success | “Invitation declined.” No household access granted. Synchronize the sender's status; household association projection is missing today. |
| Recovery request | RESET_PASSWORD_DISABLED | “You can’t reset your password right now. Please try again later.” Back to log in; no help destination, per user decision. This is the current configuration, not a successful email-sent state. |
| Recovery request, enabled | Unknown or known email | “If an account uses this email, we’ll send a reset link.” Same confirmation and timing policy; no account disclosure. |
| Reset callback/completion | INVALID_TOKEN, expired/used token callback error | “This reset link is no longer valid.” Request a new link. |
| Reset completion | PASSWORD_TOO_SHORT, PASSWORD_TOO_LONG | New-password FieldError. |
| Reset completion | USER_NOT_FOUND | Same invalid-link recovery; do not disclose account deletion details. |

Teams, social login, account deletion and role management are not configured onboarding actions. Their unrelated plugin error catalog is not presented as live onboarding behavior.

## Failures shared by every screen

| Result | Presentation and recovery |
| --- | --- |
| Request schema rejection / malformed input | Map known field violations to FieldError. Unmappable violations use “Check your details and try again.” Keep values; do not expose raw validation payloads. |
| Session missing/expired (401, unauthorized) | “Your session has expired. Log in to continue.” Preserve safe setup drafts and intended invitation/step. Distinguish INVALID_EMAIL_OR_PASSWORD from a session-expiry redirect. |
| 429 | “Too many attempts. Try again in {seconds}.” Respect validated X-Retry-After from pinned Better Auth; use neutral “Try again shortly” without a valid duration. Disabled retry until allowed; announce without a per-second screen-reader stream. |
| Network failure, empty/malformed response, 5xx, auth output-fence 503 | “We couldn’t confirm that change.” If a mutation may have committed, reconcile its exact original identity before permitting another create. For read-only loads, offer Try again. |
| Trusted-origin / CSRF rejection | “We couldn’t verify this request. Reload the page and try again.” Safe values retained; no raw security/config data shown. |
| Unexpected code | Safe contextual fallback and diagnostic code internally. Never display credentials, private payloads or raw server exceptions. |

## Household API failures

These are application-owned, not Better Auth codes. They apply to creator bootstrap, person creation, roster/review and account association.

| Code | User copy / recovery |
| --- | --- |
| invalid_request | Field errors where the failing input is known; otherwise “Check your details and try again.” |
| person_not_found | “This person is no longer in the family.” Reload roster. |
| creator_required, organizer_required | “Only the family organiser can do this.” Return to the roster. |
| control_plane_resource_not_found | “This invitation or membership is no longer available.” Refresh its state. |
| mutation_collision | “This action no longer matches the saved request.” Recover the original command; do not silently invent another mutation ID. |
| bootstrap_conflict | “This family already has a creator profile.” Refresh canonical account/person linkage; do not create a second creator. |
| stale_version, association_stale | “This family changed elsewhere. Review the latest details.” Refresh before resubmission. |
| lifecycle_conflict, association_conflict, departure_conflict | “This person’s status has changed.” Refresh canonical state and show the permitted next action; do not repeat an illegal transition. |
| people_unavailable, control_plane_unavailable | “We couldn’t finish that change.” Retain the exact person/invitation command and recover the incomplete stage. |
| unauthorized | Session-expired behavior above. |
| internal_error | Safe contextual unavailable state with no raw error text. |

Review and Ready contain no new data-entry inputs. Their errors are roster/session load and link-completion failures. An account which accepted an invitation but has not completed person linking gets “You’ve joined. We’re finishing your profile.” with a targeted Finish setup action, not another Join action.

## Add and invite partial completion

1. New adult: collect name, adult type and email; action is Add and invite.
2. While saving: one pending state owns both operations; preserve exact command identities.
3. Person created but invitation not confirmed: “Jamie was added. We couldn’t confirm the invitation.” Action Finish invitation retries only the retained invitation stage. No second person is created.
4. Invitation delivered/pending: sender sees Invitation sent/Pending; recipient sees Join family and Decline invitation.
5. Decline does not silently erase the household's person record. The future association/status contract must make the distinction explicit.
6. Dependant: create a managed person without an invitation. No DOB or age-derived portions are implied.

## Confirmed recovery and safe pause destinations

The [transition contract](onboarding-transitions.md) defines request → check email → valid email link → new password → confirmed success → Log in, with the original setup/invitation intent preserved. Generic confirmation is the same for known and unknown emails. New-password success is not automatic sign-in. Invalid-token recovery returns to a fresh request. Delivery remains G07; no help CTA or destination is added.

Partial invitation, unavailable roster and unfinished linking each expose Save & exit. A successful checkpoint save opens Setup saved with the pending step and Resume setup / Log out. A failed checkpoint save stays on the origin with “We couldn’t save your place. Try again.” Resume reconciles canonical state and the exact pending operation before deciding what still needs work. It cannot recreate the person/family, repeat a settled invitation, or claim an uncertain change succeeded. Passwords and reset tokens are excluded from durable drafts. These are acceptance rules for open G09/G10.

## Evidence

- Local installed Better Auth 1.7.2: `dist/api/routes/sign-up.mjs` 145–265; `sign-in.mjs` 307–357; `password.mjs` 51–162.
- Organization plugin: `dist/plugins/organization/routes/crud-org.mjs` create/get/set-active; `crud-invites.mjs` create/get/accept/reject/list-user-invitations.
- Rate limiter: `dist/api/rate-limiter/index.mjs` rateLimitResponse.
- Repo: `apps/api/src/features/auth/auth.ts`; `packages/household-api/src/{people,people-http,profiles}.ts`; `apps/api/src/features/households/people/household-people.control-plane.ts`.
- [shadcn TanStack Form integration](https://ui.shadcn.com/docs/forms/tanstack-form).
- [Better Auth email/password](https://better-auth.com/docs/authentication/email-password) and [organizations](https://better-auth.com/docs/plugins/organization). Installed source owns version-specific behavior if current online docs differ.
