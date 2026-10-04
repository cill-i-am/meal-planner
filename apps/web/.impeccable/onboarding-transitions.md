# Family onboarding transitions

The September 22, 2026 Paper transitions preserve visual, focus and recovery destinations. [Saved-resource family setup](../../../docs/reference/family-api.md) owns behavior; its [D26 decision](../../../docs/plans/family-resource-onboarding.md#d26--no-persisted-browser-mutations-27-september-2026) replaced checkpoint and persisted-draft transitions. See [remaining acceptance](../../../docs/plans/onboarding.md) and [error presentation](onboarding-error-contract.md).

## Password recovery

Recovery screens and token handling are implemented. Real delivery remains in the [email activation plan](../../../docs/plans/auth-email-delivery.md). Never show a successful request confirmation for RESET_PASSWORD_DISABLED. All screens have desktop and mobile counterparts on the Recovery page.

| From | Trigger | Destination / behavior |
| --- | --- | --- |
| Log in | Forgot password | Request reset when available; otherwise Reset unavailable with Back to log in. Carry the intended setup/invitation continuation. |
| Request reset · screen 1 | Valid request succeeds | Check your email · screen 2. Same generic confirmation for known and unknown addresses: “If an account uses this email, we’ll send a reset link.” |
| Check your email | Use another email | Request reset, with the submitted email retained and editable. |
| Check your email | Back to log in | Log in; preserve intended continuation. |
| Reset email | Valid reset link | Choose a new password · screen 3. Keep the reset token out of browser storage. |
| New password | Save new password succeeds | Password updated · screen 4. Clear both password fields and the consumed token. Success is shown only after confirmation. |
| Password updated | Log in | Log in, then the original permitted setup/invitation destination after authentication. No automatic sign-in is implied. |
| New password / validation | Back to log in | Log in; discard the password draft. |
| Invalid, expired or used reset link | Request a new link | Request reset; preserve the intended continuation without reusing the invalid token. Copy and endpoint mapping live in the error contract. |
| Any recovery submit | Field, rate-limit, network or service failure | Stay on the relevant form/state and follow the error contract; do not advance to success. |

Paper IDs: request D `4U-0` / M `UC-0`; check email D `2YD-0` / M `2YV-0`; new password D `2ZO-0` / M `30K-0`; updated D `31R-0` / M `329-0`. Get help copy remains removed.

## Log out and return

Log out ends the session without saving navigation or form drafts. Reload and later login read the saved family and people resources, then select the permitted route. Setup saved and durable checkpoint destinations belong to the replaced Paper flow.

While the submitting screen is mounted, preserve the exact command, target, versions and request identity when its result is unknown. Retry only through its existing recovery action. Reload does not replay a browser command. Saved person, invitation and membership results remain canonical; a return must not recreate a person or accept an already-settled invitation. Do not store passwords, reset tokens or submitted setup drafts in browser storage.

## Person type and optional invitation

Use the shadcn single-selection ToggleGroup with the explicit theme classes. Give the group an accessible label through `aria-labelledby`; connect its FieldDescription/FieldError using `aria-describedby`. Set `aria-invalid="true"` on the group only after blur/submit validation, and `data-invalid` on its Field wrapper. Keep the two items and their focus behavior from the primitive.

The group invalid modifier supplies the destructive outline and halo shown in Paper. On a failed submit, focus the selected item, or the first item when empty, and announce the linked error. Do not fabricate a selection. The explicit focus rule follows the selected border rule, so the solid ring edge wins for selected and unselected items.

The choices are **Adult** and **Child**. Person type is independent of account access. A child has no account; an adult can also participate in family meal planning without one. For adults, show a separate **Invite them to join** checkbox, unchecked initially. Email is required only when inviting. The primary action is **Add person**, or **Add and invite** when the checkbox is checked. Changing person type clears the invitation choice so it cannot carry over silently.

The mounted form retains the draft and invitation choice. After submission, keep the exact creation and invitation commands for mounted recovery. An uninvited adult appears as **Adult**, with **Invite to join** as a separate, optional action on the people list and family review. Do not describe an invitation as required.
