# TanStack Form + Effect Schema

This is an integration example, not the production authentication specification.
Read the [form contract](../reference/forms.md) and installed APIs for the actual
flow. `createAccountMutation`, field primitives and error formatting below stand
for the owning application's existing adapters, not new libraries to introduce.

## Canonical Pattern

Define one Effect Schema for the form shape. Use that same schema for live validation and for submit-time decoding.

```tsx
import { useForm } from "@tanstack/react-form";
import * as Schema from "effect/Schema";

const EmailAddressSchema = Schema.Trim.check(
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: "Enter a valid email address.",
  })
).pipe(Schema.brand("EmailAddress"));

const CreateAccountSchema = Schema.Struct({
  email: EmailAddressSchema,
  password: Schema.String.check(
    Schema.isMinLength(8, {
      message: "Password must be at least 8 characters.",
    })
  ),
});

type CreateAccount = Schema.Schema.Type<typeof CreateAccountSchema>;

const createAccountValidator = Schema.toStandardSchemaV1(CreateAccountSchema);
const parseCreateAccount = Schema.decodeUnknownSync(CreateAccountSchema);

function CreateAccountForm() {
  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    validators: {
      onChange: createAccountValidator,
      onSubmit: createAccountValidator,
    },
    onSubmit: async ({ value }) => {
      const input: CreateAccount = parseCreateAccount(value);
      await createAccountMutation(input);
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      {/* fields */}
    </form>
  );
}
```

TanStack Form submits the Standard Schema input value, not transformed output. Decode inside `onSubmit` before calling mutations so brands, transforms, and domain types are earned at the boundary.

Do not copy the example's new-password length rule into a login flow.

## Field Markup

Use the project's `Field` primitives and TanStack Form field state together:

```tsx
<form.Field
  name="email"
  children={(field) => {
    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

    return (
      <Field data-invalid={isInvalid}>
        <FieldLabel htmlFor={field.name}>Email</FieldLabel>
        <Input
          id={field.name}
          name={field.name}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.value)}
          aria-invalid={isInvalid}
          autoComplete="email"
        />
        {isInvalid ? (
          <FieldError errors={fieldErrors(field.state.meta.errors)} />
        ) : null}
      </Field>
    );
  }}
/>
```

Normalize validation errors for `FieldError` with a tiny local helper when needed. Keep it local unless several forms need the same helper.

## Shared field components

When multiple forms repeat field wiring, use TanStack Form's supported
`createFormHook` and `createFormHookContexts` APIs. Register the field components
once, then compose explicit `form.AppField` elements inside shadcn `FieldGroup`.
Keep the schema, fields and actions visible in each form. Do not select an entire
screen's structure with a boolean mode or a field-name loop.

The [shared form components](../../apps/web/src/components/forms/form.tsx) show
this pattern for text and password fields. Their [login and signup compositions](../../apps/web/src/features/auth/auth-screens.tsx)
share field behavior while keeping separate draft shapes and validation schemas.
Use `InputGroupInput`, `InputGroupAddon` and `InputGroupButton` for a password
visibility control. Let component variants and semantic theme tokens own styling.

## Submit Buttons

Use `form.Subscribe` for submit state instead of `useState`:

```tsx
<form.Subscribe
  selector={(state) => ({
    canSubmit: state.canSubmit,
    isSubmitting: state.isSubmitting,
  })}
  children={({ canSubmit, isSubmitting }) => (
    <Button type="submit" disabled={!canSubmit || isSubmitting}>
      {isSubmitting ? "Creating account..." : "Create account"}
    </Button>
  )}
/>
```

## Mutations

Browser forms submit through the appropriate typed client; canonical writes and authorization remain server-owned. Use TanStack Query mutations or the relevant client library state when mutation status needs to drive UI. Convert structured client errors into a normal mutation failure so the form does not render a failed mutation as success.

Do not retry mutations unless the command has an explicit idempotency strategy.

Keep mutation wiring in the route or page while the workflow is still taking shape. Extract only shared schemas, parsers, and small boundary adapters into the feature slice, for example `src/features/auth/shared/*`. Do not create a reusable `AuthForms`-style component unless deleting it would spread meaningful complexity across several callers.

## Reactions

For field-change reactions, use TanStack Form listeners:

```tsx
<form.Field
  name="country"
  listeners={{
    onChange: () => {
      form.setFieldValue("province", "");
    },
  }}
>
  {/* field */}
</form.Field>
```

Use listener debouncing for autosave or async field reactions. Avoid `useEffect` for normal field derivation.
