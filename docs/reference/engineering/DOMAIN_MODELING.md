# Domain Modeling

Use types and constructors to prevent invalid states and make valid operations easy to call. Keep each invariant—the rule that must remain true—with the code that enforces it. Types should prevent mistakes, not just give ordinary values more names.

## Core vocabulary

**Domain Module** — A TypeScript module for one domain type or a closely related group of types. It exposes parsers, smart constructors, combinators, predicates, transitions, projections, arbitraries, and formatting helpers for that concept. It contains pure logic, not a Service Module with external dependencies.

**Branded Type** — A primitive with domain meaning established by a parser or smart constructor: `UserId`, `EmailAddress`, `Cents`, `Milliseconds`.

**Value Class** — An immutable class-backed domain value created only through parsers or smart constructors. It owns behavior for that value; it does not hide dependencies or perform I/O.

**State Machine** — A tagged-union or value-class lifecycle model where each state carries only legal fields and legal transitions.

**Boolean Blindness** — Losing meaning by passing or storing raw booleans for modes, policies, or lifecycle states.

## Apply this file

When changing what a domain value means or how it can change, check the relevant rules:

- construction or parsing invariants;
- required vs optional values;
- operation-specific input shape;
- lifecycle states and legal transitions;
- exhaustive handling of closed variants;
- persistence constraints or guarded writes when the invariant is persisted.

If an improvement needs a migration outside the task, explain which rule remains unresolved. Within the task, replace obsolete code and update its callers rather than adding a compatibility path.

## Non-negotiables

- Constructors, transitions and interfaces must prevent or reject known invalid states.
- If a function needs a value, its input must not allow `null`, `undefined`, or an omitted value. Check or parse the value before calling it.
- A branded/refined type is only created by code that establishes the invariant.
- A value class is immutable and is only instantiated through parsers or smart constructors.
- Lifecycle transitions accept only legal source states and produce legal target states.
- Decisions over closed variant sets are exhaustive; use the project exhaustiveness helper such as `casesHandled` when it exists.
- Caller code does not reimplement invariants owned by a parser, smart constructor, or transition.

## Strong defaults

- Use precise operation inputs instead of raw DTOs, primitive bags, broad records, or `Partial<T>`.
- Use branded/refined types or value classes for semantically distinct IDs, constrained numbers, units, and parsed strings.
- Model meaningful lifecycle states as discriminated unions or equivalent value classes.
- Use string-literal unions and discriminated unions over TypeScript `enum`; avoid numeric enums unless required by external interop.
- Use `_tag` as the internal discriminant unless another field name is real domain vocabulary.
- Inspect existing Domain Modules and types before adding a new concept; reuse an existing concept when its vocabulary and invariant match.
- Choose branded types, state machines, and value classes because they prevent realistic misuse or express a real invariant, not because the technique is fashionable.

## Domain Modules

Prefer modules named for the concept they own:

```txt
src/billing/
  invoice-number.ts
  invoice-number.test.ts
  invoice-number.arbitrary.ts
```

A domain module exposes meaningful operations around the concept:

```ts
/** A parsed, normalized email address. */
export type EmailAddress = Brand<string, "EmailAddress">;

/** Parse an email address from untrusted input. */
export function parse(input: string): Result<EmailAddress, InvalidEmailAddress>;

/** Render an email address for display or storage. */
export function toString(email: EmailAddress): string;

/** Compare two parsed email addresses. */
export function equals(left: EmailAddress, right: EmailAddress): boolean;
```

Avoid scattering `parseEmail`, `normalizeEmail`, `compareEmails`, and `emailRegex` across utilities, handlers, and tests.

## Branded and refined values

Prefer:

```ts
type UserId = Brand<string, "UserId">;

function parseUserId(input: string): Result<UserId, InvalidUserId> {
  if (!isCanonicalUserId(input)) {
    return err(new InvalidUserId(input));
  }

  // SAFETY: isCanonicalUserId established the UserId invariant before branding.
  return ok(input as UserId);
}
```

Avoid:

```ts
function loadUser(userId: string) {
  // Every caller can now mix org IDs, emails, slugs, and user IDs.
}

const userId = body.userId as UserId; // decoded data did not establish the invariant
```

When the established schema library can express the brand, use the library's branding/refinement rather than a handwritten cast.

## Value classes

Use a value class when behavior naturally belongs with an immutable value and a brand alone would leave important operations scattered.

Prefer:

```ts
class Money {
  private constructor(
    readonly cents: Cents,
    readonly currency: Currency,
  ) {}

  static create(input: MoneyInput): Result<Money, InvalidMoney> {
    // parse/refine cents and currency here
  }

  add(other: Money): Result<Money, CurrencyMismatch> {
    // preserve invariant locally
  }
}
```

Avoid value classes that hide dependencies or perform I/O:

```ts
class InvoiceNumber {
  async reserve(database: Database) {
    // value object now owns infrastructure behavior
  }
}
```

A value class is immutable, parser/smart-constructor-created, and owns value behavior only.

## Required values

Handle a missing value before calling code that requires it:

```ts
if (session.userId === undefined) {
  return err(new Unauthenticated());
}

return createInvoice({ actor: session.userId, input });
```

Do not pass an optional value to a function that cannot handle its absence:

```ts
createInvoice({ actor: session.userId, input }); // actor?: UserId
```

If absence is a real domain concept, name it clearly: `maybeFindById`, `lookupOptional`, `exists`, or an explicit `Option` in Effect code.

## Operation-specific inputs

Prefer explicit operation inputs:

```ts
type ChangeBillingEmailInput = {
  readonly actor: AccountAdmin;
  readonly accountId: AccountId;
  readonly email: EmailAddress;
};
```

Avoid broad service/domain inputs like:

```ts
function changeBillingEmail(input: Partial<Account>) {}
```

`Partial<T>` is acceptable when partiality is the domain concept, such as patch semantics owned by an External Adapter Module or a named patch command.

## State machines

Give each state only the fields it allows:

```ts
type Invoice =
  | {
      readonly _tag: "Draft";
      readonly id: InvoiceId;
      readonly lines: NonEmptyArray<LineItem>;
    }
  | { readonly _tag: "Sent"; readonly id: InvoiceId; readonly sentAt: Instant }
  | { readonly _tag: "Paid"; readonly id: InvoiceId; readonly paidAt: Instant };
```

Avoid combinations of flags and optional fields that can contradict each other:

```ts
type Invoice = {
  readonly isSent: boolean;
  readonly isPaid: boolean;
  readonly sentAt?: Date;
  readonly paidAt?: Date;
};
```

Make the input type allow only states from which this transition is valid:

```ts
function markPaid(invoice: SentInvoice, paidAt: Instant): PaidInvoice;
```

Do not accept `Invoice` and then hope every caller checked the state.

## Boolean blindness

Avoid mode booleans:

```ts
createUser(input, true);
```

Prefer named policy:

```ts
createUser(input, { emailVerification: "skip" });
```

Boolean predicate returns are fine when the name carries meaning:

```ts
isExpired(token): boolean;
hasPermission(user, permission): boolean;
```

## Exhaustiveness

Prefer `switch` for three or more variants:

```ts
switch (payment._tag) {
  case "Pending":
    return renderPending(payment);
  case "Settled":
    return renderSettled(payment);
  default:
    return casesHandled(payment);
}
```

Avoid default branches that silently swallow future variants.

## Persisted invariants

If the domain forbids `Paid` without `paidAt`, the database should help enforce that. Read-time parsing is still required, but it is not the only protection. Use constraints, unique constraints, and guarded writes where practical.

## Review checklist

Check the relevant items below when reviewing a change. The sections above explain the rules.

- Accepting raw strings for IDs because the database column is a string.
- Returning `undefined` for required lookup absence instead of a not-found failure.
- Using `Partial<T>` for command input because it is quick.
- Adding `isActive` / `isDeleted` / `completedAt?` instead of modeling lifecycle states.
- Branding with `as` at the call site instead of through the parser.
- Writing a non-exhaustive `switch` and relying on tests to notice future variants.
