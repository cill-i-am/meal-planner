# shadcn components

The app uses the shadcn/ui Base UI `base-nova` registry. Run the CLI from `apps/web`; `components.json` identifies the style, aliases and theme file.

Alert, Button, Input, Label, Field, InputGroup and Textarea follow the official registry source. Local changes cover imports, repository formatting and the Meal Planner theme. Field includes the standard grouping, orientation and error-list APIs. InputGroup owns the password input's border, focus state and visibility addon.

Components own their variants and interaction styles in Tailwind. Auth layout, typography, responsive behavior, gradients and interaction states also use Tailwind utilities. The stylesheet retains semantic theme variables and the custom drift keyframes, with no auth layout or state selectors. `src/styles.css` maps semantic colors and control dimensions to the existing workspace theme and the Paper auth theme. Avoid page-level selectors that override button variants or input states. Native controls in unfinished screens still have their existing styles; they are not shadcn components.

Authentication uses TanStack Form's `createFormHook` and `AppField` to bind shared text/password fields to shadcn controls. Login and signup explicitly compose their own fields, schemas and actions. TanStack Form owns drafts and validation; TanStack Query owns the pending authentication request and service failure.

References:

- [TanStack Form integration](https://ui.shadcn.com/docs/forms/tanstack-form)
- [Form composition](https://tanstack.com/form/latest/docs/framework/react/guides/form-composition)
- [Field](https://ui.shadcn.com/docs/components/base/field)
- [InputGroup](https://ui.shadcn.com/docs/components/base/input-group)
- [Button](https://ui.shadcn.com/docs/components/base/button)
- [Input](https://ui.shadcn.com/docs/components/base/input)

The component sources were checked with shadcn CLI 4.21.0 on 21 September 2026 against the installed Base UI 1.8.0 and TanStack Form 1.33.5. The earlier design snapshot remains in `.impeccable/reference/shadcn-base-nova`.

The [MIT license](./LICENSE-shadcn.md) applies to the copied component source.
