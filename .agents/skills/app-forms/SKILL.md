---
name: app-forms
description: Integrate TanStack Form with Effect Schema validation and typed command submission.
---

# Forms

Use the [shared form contract](../../../docs/reference/forms.md) and
[implementation example](../../../docs/how-to/build-a-form.md) for a changed form
flow. Preserve explicit submit decoding, safety confirmation and exact-command
recovery; generic validity is not consent. Keep one owner for field and mutation
state. Inspect the current primitive/adapter instead of introducing another form
framework. Use relevant field, command and browser evidence; copy-only changes do
not require a form redesign.
