# Family onboarding transitions

Design contract, 20 September 2026. The user approved Save & exit with resumption of the pending step. These are Paper destinations and implementation acceptance rules; the application does not implement them yet. See [implementation gaps](../../../docs/plans/onboarding.md) and [error mapping](onboarding-error-contract.md).

## Password recovery

Recovery remains proposed until G07 provides real delivery. Never show a successful request confirmation for RESET_PASSWORD_DISABLED. All screens have desktop and mobile counterparts on the Recovery page.

| From | Trigger | Destination / behavior |
| --- | --- | --- |
| Log in | Forgot password | Request reset when available; otherwise Reset unavailable with Back to log in. Carry the intended setup/invitation continuation. |
| Request reset · screen 1 | Valid request succeeds | Check your email · screen 2. Same generic confirmation for known and unknown addresses: “If an account uses this email, we’ll send a reset link.” |
| Check your email | Use another email | Request reset, with the submitted email retained and editable. |
| Check your email | Back to log in | Log in; preserve intended continuation. |
| Reset email | Valid reset link | Choose a new password · screen 3. Do not store the reset token in a durable setup draft. |
| New password | Save new password succeeds | Password updated · screen 4. Clear both password fields and the consumed token. Success is shown only after confirmation. |
| Password updated | Log in | Log in, then the original permitted setup/invitation destination after authentication. No automatic sign-in is implied. |
| New password / validation | Back to log in | Log in; discard the password draft. |
| Invalid, expired or used reset link | Request a new link | Request reset; preserve the intended continuation without reusing the invalid token. Copy and endpoint mapping live in the error contract. |
| Any recovery submit | Field, rate-limit, network or service failure | Stay on the relevant form/state and follow the error contract; do not advance to success. |

Paper IDs: request D `4U-0` / M `UC-0`; check email D `2YD-0` / M `2YV-0`; new password D `2ZO-0` / M `30K-0`; updated D `31R-0` / M `329-0`. Get help copy remains removed.

## Save, exit and resume

Save & exit writes an authenticated checkpoint, then opens Family → Setup saved, state 6 (D `332-0` / M `33K-0`). The confirmation says the user can close the page, names their next step, and offers Resume setup or Log out. The illustrated pending invitation is a synthetic example; the next-step label follows the actual checkpoint.

| Origin | Next-step label | Resume rule |
| --- | --- | --- |
| Finish Jamie’s invitation | Finish Jamie’s invitation | Reconcile the retained person and invitation command. If invitation completion is still needed, return to that stage. If settled, advance to the current People view. Never create a second person or blindly send another invitation. |
| Your family didn’t load | Review your family | Reload the canonical roster for the saved family. Return to Review on success, or its unavailable state on failure. Do not treat missing data as an empty family. |
| Finish joining your family | Finish joining your family | Check the accepted invitation, membership and person link. Complete only the retained linking operation; if already linked, advance to Ready. Do not accept the invitation or create a profile again. |
| Ordinary incomplete setup | The incomplete step’s title | Restore safe draft values, then reconcile them with current canonical state. Resolve an existing person draft before moving on. |

Only show Setup saved after the required checkpoint is durable. If saving fails, remain on the origin and show “We couldn’t save your place. Try again.” Retrying saves the same checkpoint. Save & exit does not cancel, retry or declare success for an uncertain operation, and must not race a second mutation against it.

Retain only the safe draft, intended step, owning account/family/person context and original pending command identity needed to resume. Never persist passwords, reset tokens or raw auth/provider payloads in browser storage. The implementation must choose an authenticated persistence boundary; Paper does not establish one.

Resume setup, returning after a closed page, and logging in again all resolve the checkpoint against canonical state. An expired session goes through Log in with the intended continuation retained. Changed permissions or a removed family use the corresponding access state; they never fall back to creating a replacement family. Log out clears the session and in-memory secrets, while retaining the account-owned checkpoint for a later authenticated return.

## Person type and optional invitation

Use the shadcn single-selection ToggleGroup with the explicit theme classes. Give the group an accessible label through `aria-labelledby`; connect its FieldDescription/FieldError using `aria-describedby`. Set `aria-invalid="true"` on the group only after blur/submit validation, and `data-invalid` on its Field wrapper. Keep the two items and their focus behavior from the primitive.

The group invalid modifier supplies the destructive outline and halo shown in Paper. On a failed submit, focus the selected item, or the first item when empty, and announce the linked error. Do not fabricate a selection. The explicit focus rule follows the selected border rule, so the solid ring edge wins for selected and unselected items.

The choices are **Adult** and **Child**. Person type is independent of account access. A child has no account; an adult can also participate in family meal planning without one. For adults, show a separate **Invite them to join** checkbox, unchecked initially. Email is required only when inviting. The primary action is **Add person**, or **Add and invite** when the checkbox is checked. Changing person type clears the invitation choice so it cannot carry over silently.

Save & exit retains the draft and invitation choice. After submission, retain the exact creation and invitation commands for recovery. An adult added without an account appears as **Adult · No account**, with an optional invitation action on the family review screen. Do not describe an invitation as required.
