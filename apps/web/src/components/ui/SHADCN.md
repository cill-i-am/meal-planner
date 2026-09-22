# shadcn components

The app uses the shadcn/ui Base UI `base-nova` registry. Run the CLI from `apps/web`; `components.json` identifies the style, aliases and theme file.

Alert, Button, Dialog, Drawer, DropdownMenu, Input, Label, Field, InputGroup and Textarea follow the official registry source. Local changes cover imports, repository formatting and the Meal Planner theme. Field includes the standard grouping, orientation and error-list APIs. InputGroup owns the password input's border, focus state and visibility addon.

Components own their variants and interaction styles in Tailwind. Auth layout, typography, responsive behavior, gradients and interaction states also use Tailwind utilities. The stylesheet retains semantic theme variables and the custom drift keyframes, with no auth layout or state selectors. `src/styles.css` maps semantic colors and control dimensions to the existing workspace theme and the Paper auth theme. Avoid page-level selectors that override button variants or input states. Native controls in unfinished screens still have their existing styles; they are not shadcn components.

Authentication uses TanStack Form's `createFormHook` and `AppField` to bind shared text/password fields to shadcn controls. Login and signup explicitly compose their own fields, schemas and actions. TanStack Form owns drafts and validation; TanStack Query owns the pending authentication request and service failure.

## Responsive overlays

`Overlay` composes the shadcn Dialog and current Base UI Drawer. Below 768px it uses a bottom sheet with Base UI keyboard handling; on desktop it uses a dialog by default. Keep the form owner and draft state in the feature component above `Overlay.Root`, so the draft survives a viewport change. Include `Overlay.Title` and `Overlay.Description` in every content surface.

```tsx
const [open, setOpen] = useState(false);
const [draft, setDraft] = useState(""); // Owned outside the presentation branch.
const clearAfterClose = (isOpen: boolean) => {
  if (!isOpen) setDraft("");
};

<Overlay.Root
  open={open}
  onOpenChange={setOpen}
  desktop="dialog"
  dialogProps={{ onOpenChangeComplete: clearAfterClose }}
  drawerProps={{ onOpenChangeComplete: clearAfterClose }}
>
  <Overlay.Trigger render={<Button />}>Edit person</Overlay.Trigger>
  <Overlay.Content data-theme="auth">
    <Overlay.Header>
      <Overlay.Title>Edit person</Overlay.Title>
      <Overlay.Description>Update their family profile.</Overlay.Description>
    </Overlay.Header>
    <Overlay.Body>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="person-name">Name</FieldLabel>
          <Input
            id="person-name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
      </FieldGroup>
    </Overlay.Body>
    <Overlay.Footer>
      <Overlay.Close render={<Button variant="outline" />}>
        Cancel
      </Overlay.Close>
    </Overlay.Footer>
  </Overlay.Content>
</Overlay.Root>;
```

For a desktop side panel, use `desktop="drawer"` and pass native options through `desktopDrawerProps`. Nested confirmations live inside the parent body:

```tsx
<Overlay.Root desktop="drawer" desktopDrawerProps={{ swipeDirection: "right" }}>
  <Overlay.Trigger>Open details</Overlay.Trigger>
  <Overlay.Content data-theme="auth">
    <Overlay.Header>
      <Overlay.Title>Details</Overlay.Title>
      <Overlay.Description>Review this person.</Overlay.Description>
    </Overlay.Header>
    <Overlay.Body>
      <Overlay.Root>
        <Overlay.Trigger>Confirm removal</Overlay.Trigger>
        <Overlay.Content data-theme="auth">
          <Overlay.Header>
            <Overlay.Title>Remove person?</Overlay.Title>
            <Overlay.Description>
              This removes their family access.
            </Overlay.Description>
          </Overlay.Header>
          <Overlay.Body>
            <Overlay.Close>Keep person</Overlay.Close>
          </Overlay.Body>
        </Overlay.Content>
      </Overlay.Root>
    </Overlay.Body>
  </Overlay.Content>
</Overlay.Root>
```

Base UI keeps the parent mounted and restores focus after the nested surface closes. For a dirty draft or pending mutation, call `details.cancel()` in `onOpenChange` before opening a nested confirmation; the same callback covers swipe, Escape, backdrop and Close. Long sheets can use native `drawerProps={{ snapPoints: [0.6, 1], defaultSnapPoint: 0.6 }}`. The lower-level `Dialog`, `Drawer`, `DrawerVirtualKeyboardProvider` and their parts remain available in their own files. Because Base UI portals into `body`, set `data-theme="auth"` on `Overlay.Content` and `DropdownMenuContent` when used inside the onboarding theme.

References:

- [TanStack Form integration](https://ui.shadcn.com/docs/forms/tanstack-form)
- [Form composition](https://tanstack.com/form/latest/docs/framework/react/guides/form-composition)
- [Field](https://ui.shadcn.com/docs/components/base/field)
- [InputGroup](https://ui.shadcn.com/docs/components/base/input-group)
- [Button](https://ui.shadcn.com/docs/components/base/button)
- [Input](https://ui.shadcn.com/docs/components/base/input)
- [Drawer](https://ui.shadcn.com/docs/components/base/drawer)
- [Base UI Drawer keyboard and nesting](https://base-ui.com/react/components/drawer)

The component sources were checked with shadcn CLI 4.21.0 on 21 September 2026 against the installed Base UI 1.8.0 and TanStack Form 1.33.5. The earlier design snapshot remains in `.impeccable/reference/shadcn-base-nova`.

The [MIT license](./LICENSE-shadcn.md) applies to the copied component source.
