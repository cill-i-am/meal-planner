# Forms and commands

TanStack Form manages field values and updates. Effect Schema validates input and
converts it into the values the application uses. Reuse the API input schema when
the form submits the same shape. When a draft has a different shape, keep that
conversion explicit. Standard Schema validation may not return a transformed or
branded value. Decode the submitted data before creating the typed command.

Keep one owner for the form state and one for an unfinished save. Use subscriptions
and listeners instead of copying the same values into React state or effects.
Show accurate, accessible labels, field errors, validation timing, pending states
and service failures. Follow the [agreed design](../../apps/web/DESIGN.md).
Moving every prototype field to shadcn is still [unfinished work](../plans/onboarding.md).

A valid form is not consent to confirm a safety-related fact or share a private
proposal. If the fact kind or target changes, discard consent for the previous
version. If a response is lost and you cannot tell whether a save succeeded, keep
the original command, payload, mutation ID and required version/account binding.
A new draft or late callback must not replace that unresolved request. Retry
automatically only when the command's rules make repeating it safe. The server
still checks access and validates input, even when the client has done so.

Login requires credentials but must not apply the rules for creating a new
password. Creating an invitation or reset record does not prove an email was sent.
The [onboarding error rules](../../apps/web/.impeccable/onboarding-error-contract.md)
and [screen transitions](../../apps/web/.impeccable/onboarding-transitions.md)
describe the agreed flow. The onboarding plan tracks what remains to be built.

## Implementation and verification

Use [the form guide](../how-to/build-a-form.md) and
[parsing standards](engineering/BOUNDARIES_AND_PARSING.md). Start with the
[profile form](../../apps/web/src/features/household-profiles/profile-fact-form.tsx),
[profile API types](../../packages/household-api/src/profiles.ts) and their tests.
Check submissions, converted values, expired consent, uncertain save results,
keyboard use and error messages for the flow you change. Form validity must not
replace explicit confirmation. Do not introduce another form framework.
