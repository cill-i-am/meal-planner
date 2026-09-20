# Forms and commands

TanStack Form owns field values/reactivity. Effect Schema owns input validation
and domain decoding. Reuse the canonical input contract where shapes match;
distinguish raw UI drafts from domain values where they do not. Standard Schema
validation does not establish that submission received transformed/branded output:
decode at submission before constructing the typed command.

Keep one owner for form state and for the outstanding mutation. Use subscriptions
and listeners rather than mirrored React state/effects. Field errors, labels,
blur/change timing, disabled/pending state and service errors must remain honest
and accessible. Use current primitives and the agreed [design contract](../../apps/web/DESIGN.md);
shadcn adoption is [unfinished work](../plans/onboarding.md), not a claim that every
prototype field already uses it.

Validation cannot imply safety consent or promote a provisional fact. A change
of fact kind/target invalidates stale consent. Preserve the original command,
payload, mutation ID and applicable version/binding across ambiguous responses;
a changed draft or late callback cannot replace that unresolved intent. Automatic
retry needs the command's explicit idempotency contract. Server admission and
validation remain authoritative regardless of client validation.

Login validates required credentials; it does not reapply new-password creation
rules. Reset/invitation UI cannot claim email delivery from a created record alone.
The [onboarding error](../../apps/web/.impeccable/onboarding-error-contract.md) and
[transition](../../apps/web/.impeccable/onboarding-transitions.md) specifications
own the agreed target flow, with remaining implementation in its plan.

## Implementation and verification

Use [the form procedure](../how-to/build-a-form.md) and the
[boundary standards](engineering/BOUNDARIES_AND_PARSING.md). Inspect
[profile form](../../apps/web/src/features/household-profiles/profile-fact-form.tsx),
[profile contracts](../../packages/household-api/src/profiles.ts) and their colocated
tests. Verify actual submissions, transformation, stale safety consent, unknown
outcomes and keyboard/error behavior for the changed flow. Do not replace domain
confirmation with generic form validity or introduce a new form framework.
