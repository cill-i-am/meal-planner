---
name: app-forms
description: Connect TanStack Form to Effect Schema validation and typed commands.
---

# Forms

For form behavior changes, use the [form rules](../../../docs/reference/forms.md)
and [worked example](../../../docs/how-to/build-a-form.md). Decode submitted values
before building commands. Keep explicit safety confirmation and recovery of the
exact original request; valid fields do not establish consent.

Give field values and pending mutations one owner each. Check the existing UI
components and adapter before adding anything new. Use relevant field, command,
and browser checks. A copy edit does not require redesigning the form.
