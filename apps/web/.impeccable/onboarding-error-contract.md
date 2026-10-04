# Onboarding error presentation

The September 20, 2026 Paper review established the visual treatment below. Current behavior, validation schemas and safe error mapping belong to the [form reference](../../../docs/reference/forms.md), [family API](../../../docs/reference/family-api.md) and [auth/family feature map](../../../docs/reference/features/auth-family/README.md). The [onboarding plan](../../../docs/plans/onboarding.md) owns remaining acceptance.

## Fields and failures

Use shadcn Field, FieldLabel, FieldDescription, FieldError, Input, Button and Alert with TanStack Form. Effect Schema supplies Standard Schema validation; decode submitted values with the owning command schema. Preserve the actual field rules and the distinction between login and new-password validation.

Show visited or submitted field errors beside their inputs, linked through `aria-describedby` and `aria-invalid`. Focus the invalid input on submit. Reinforce error color with words and a border; use at least 14px/20px error text. Place a form failure before its action. A failure that prevents loading gets a content state with a permitted recovery action. Keep password visibility and links keyboard accessible.

The single-selection ToggleGroup has an accessible label and linked error. Its whole-group invalid outline/halo and solid focus edge follow the [person-type focus rules](onboarding-transitions.md#person-type-and-optional-invitation). Do not show a branch's helper before a selection is made.

## Request and recovery ownership

Feature hooks own pending state, result classification, retained requests and invalidation. Screens own drafts and navigation. An unknown write keeps its exact original command while mounted. Confirmed person creation survives an invitation failure; recovery retries only the unsettled stage. Recipient decline does not remove the person or grant household access.

Log out does not save a checkpoint. Reload reads canonical resources and does not restore or replay a browser command. [Decision D26](../../../docs/plans/family-resource-onboarding.md#d26--no-persisted-browser-mutations-27-september-2026) owns this lifetime rule. Keep passwords, reset tokens and raw auth/provider values out of browser storage, presentation and records.

Reset confirmation remains generic for known and unknown accounts. A disabled reset callback shows the unavailable state; it must not claim a successful send. Password-updated success follows confirmed token consumption and does not imply automatic sign-in. The [email plan](../../../docs/plans/auth-email-delivery.md) tracks production activation and mailbox receipt separately from provider submission.
