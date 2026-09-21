---
name: Meal Planner
description: Calm family setup with a soft pastel glow and focused forms.
---

# Meal Planner design

## Overview

[Paper is the source of truth for the visual design](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0). This document records the onboarding design reviewed on 21 September 2026. Check the relevant live screens, states, and tokens before adding or changing UI. The working rules are in [AGENTS.md](AGENTS.md).

The application uses a white surface with a diffuse lilac, blue, rose, and peach gradient behind the upper content. Opaque white task cards, white fields, primary-colored underlined links, pastel avatars, and black pill buttons complete the theme. The framed card footer separates secondary navigation or supporting lists from the main task. Keep the task easy to scan. Brand details support the form without adding extra steps or explanatory copy.

shadcn remains the component foundation, using Base UI primitives and semantic tokens. Other libraries provide visual inspiration, not replacement component APIs. The current framed cards and subtle control depth draw from [coss UI references](.impeccable/reference/coss-ui/REFERENCES.md). The Meal Planner theme applies that direction to our shadcn components with Tailwind.

This baseline covers login, signup, family setup, people, invitations, and password recovery. See [the snapshot index](.impeccable/snapshots/index.md) for historical desktop and mobile references and [the surface brief](.impeccable/onboarding-shape.md) for scope and product decisions.

## Colors

OKLCH is the canonical colour format, following shadcn's theme convention. Define colours once in semantic theme tokens and use those tokens throughout components. Authored colour mixes use OKLCH too. The conversion preserves the existing palette.

The [reference theme](.impeccable/reference/shadcn-theme.css) records the agreed values and their shadcn mapping. It is not imported by the application. Read live Paper tokens when checking or extending the design, then update this reference if an agreed value changes.

| Role | Tokens | Baseline value |
| --- | --- | --- |
| Application surface and primary-button text | `background`, `primary-foreground` | `oklch(1 0 0)` |
| Main text, primary actions and links | `foreground`, `primary` | `oklch(0.179001 0.006108 285.766684)` |
| Secondary surfaces | `muted`, `secondary` | `oklch(0.967717 0.002652 286.345148)` |
| Supporting text | `muted-foreground` | `oklch(0.510232 0.015661 285.831807)` |
| Soft accent surface | `accent` | `oklch(0.950249 0.019117 299.064627)` |
| Pastel background light | `glow-lilac`, `glow-blue`, `glow-rose`, `glow-peach` | `oklch(0.929125 0.029673 305.111474)`, `oklch(0.943093 0.024302 238.405236)`, `oklch(0.937506 0.025952 339.383457)`, `oklch(0.948203 0.024788 65.581335)` |
| Focus | `ring` | `oklch(0.50632 0.187655 262.537119)` |
| Invalid input and error text | `destructive` | `oklch(0.457944 0.154117 20.207901)` |
| Separators | `border` | `oklch(0.935168 0.005355 286.294472)` |
| Field and selected-segment boundary | `input` | `oklch(0.655904 0.011736 286.073499)` |

Auth navigation uses Button’s link variant and inherits `primary`. Account-switch links live in the muted card footer, with an explicit gap after the prompt. Underline links and retain a 44px target. Signup has no duplicate header login action.

Use `foreground` on secondary and accent surfaces. Keep a visible input boundary; the light field fill alone does not identify the control clearly. Use error text as well as color. Avatar pastels identify people without implying status.

## Typography

Use Inter with a system sans-serif fallback. Use regular text for content, medium text for action labels, and semibold text for headings. Headings use tight tracking (`-0.025em`).

The following sizes are the reviewed baseline. Sizes are font size / line height.

| Role | Desktop | Mobile |
| --- | --- | --- |
| Routine task heading | 28px / 36px | 24px / 32px |
| Welcome or completion emphasis, where shown in Paper | 48px / 52px | 32px / 36px |
| Body | 16px / 24px | 16px / 24px |
| Input text | 14px / 20px | 16px / 24px |
| Labels, actions, helpers, and errors | 14px / 20px | 14px / 20px |

Keep headings short and task-specific. Use **family** in product copy. Remove introductions that repeat the heading or describe an obvious interaction. Preserve copy that explains an invitation, privacy choice, password requirement, or recovery action.

## Layout

Signup is a standalone account-creation screen. Do not show an Account / Family / People progress stepper on signup, including validation states. This was agreed and applied to the desktop and mobile Paper screens on 21 September 2026.

Onboarding uses a centered task card with left-aligned content and one primary action. Auth, invitations and recovery use a 480px desktop card; dense family and people screens use 560px. Desktop padding is 40px. At 390px, the card has 16px outside gutters; auth uses 24px inner padding and dense setup uses 16px. Reduce auth padding to 16px below 360px. Width stays fluid and long content scrolls in the document.

The white application surface fills the browser viewport on desktop and mobile. Sky wallpaper, outer window framing, and phone status bars belong to the mockup presentation. The reference breakpoint is 768px. The main spacing steps are 8px, 10px, 12px, 16px, 20px, and 24px. Group each label, control, and helper; use larger gaps between tasks and sections.

Keep form actions before supporting lists on long mobile screens. Let the layout grow with errors, longer text, and text enlargement.

## Elevation and motion

Use the diffuse pastel gradient and fine separators to establish depth within the white application surface. The gradient fades to white around its edges and below the upper content. Place the task on an opaque white card so the gradient stays outside the controls. Compose shadcn Card with a rounded primary-content surface and CardFooter when secondary navigation or supporting people lists exist. A single-action state needs no empty footer. Use the three-layer neutral `shadow-surface` token for the card edge and elevation, following the [better-ui polish review](.impeccable/better-ui-review-2026-09-21.md). Retain the structural footer divider and avoid nested elevated person rows. Selected segments keep their visible boundary. Focus and validation halos communicate interaction state rather than decoration.

Primary and destructive buttons use a 1px white inset highlight and a small lower shadow. Secondary buttons use a lighter highlight; outline variants use a subtle lower edge. Pressed and disabled buttons lose external elevation. Ghost buttons, inline links and repeated row actions stay flat. Inputs use a barely tinted `control` surface (30% muted mixed into the background), a visible `input` edge and a shallow inset shadow (0px 2px 4px, foreground at 8%). This makes editable fields feel recessed into the card. Focus, invalid and disabled states remove decorative inset depth; input groups own the shadow around the whole control. Keep focus and invalid borders stronger than decorative depth. Implement all styling with Tailwind utilities and semantic tokens.

Shared buttons press to scale 0.96 over 150ms with ease-out. Links default to static; input actions explicitly use the `static` prop to keep their target stationary. Transition only color, background, border, shadow and scale. Reduced motion removes press scaling and transitions. Tooltips fade over 150ms with ease-out.

Navigation between login, signup and reset-unavailable uses a shared card view transition. Keep the card surface opaque and interpolate its bounds over 300ms with ease-out. Heading, fields and footer fade out over 100ms, then fade in over 200ms; keep text at its natural size. Header and gradient do not join the route animation. Direct loads, validation and navigation outside these auth routes do not animate. Reduced motion and browsers without typed view transitions use ordinary navigation. See the [motion review](.impeccable/auth-view-transitions.md) for the design rationale and verification boundary.

Paper shows the static gradient. The [motion study](.impeccable/reference/onboarding-motion.html) demonstrates a 42-second alternating drift with at most 1.5% translation and 2.5% scale. Animate only the decorative layer; keep content and controls still. Pause while a field is focused, when the page is hidden, or when the surface is offscreen. Reduced motion keeps the full static gradient. The [motion reference](.impeccable/reference/onboarding-motion.md) records the Ceird source and implementation boundary.

The live Paper Overview component reference shows default, focus, invalid, disabled, loading, hover, and pressed examples. A focused segment has a solid `ring` edge plus a 3px translucent halo. The invalid group has a destructive outline and halo.

## Shapes

Task cards use a 16px outer radius. The body shares that radius where it meets the outer surface without an inset. Primary actions use a pill radius. Fields and the segmented track use a 12px radius; segments use 9.6px. The reference theme also defines a 7.2px small radius. Main inputs, buttons, and segments are 44px high. The segmented track is 52px high, including padding.

Give secondary actions such as the password eye toggle, **Edit**, and **Save & exit** a minimum 44px target without increasing their visible text. Single-selection choices use a segmented control.

Icon-only actions have an accessible name and a shadcn Tooltip on hover and keyboard focus. Password visibility uses Show password / Hide password for both. Keep its 44px target transparent and change the eye from muted to foreground on hover; do not fill the input end with a large hover shape.

Password visibility keeps both Lucide icons mounted, using 16px icons with a 1.5px stroke. Cross-fade opacity 0–1, scale 0.25–1 and blur 4–0px over 300ms with `cubic-bezier(0.2, 0, 0, 1)`. Reduced motion switches immediately. The accessible name, tooltip and pressed state remain the static feedback.

Password visibility also plays a quiet, 20ms activation click, inspired by the [Nexvyn clipboard field](https://ui.nexvyn.dev/components/clipboard-field). Use the same feedback for pointer and keyboard activation. Sound supplements the icon, tooltip and pressed state; the action still works if audio is unavailable. Create audio only after activation and release it when the control unmounts.

## Components

Use shadcn Button, Input, InputGroup, Textarea, Card, Field, FieldLabel, FieldDescription, FieldError, Alert, Avatar, Separator and ToggleGroup as applicable. Card composition uses CardHeader, CardTitle, CardContent and CardFooter. The local CardBody groups the white primary surface above the secondary footer. Keep TanStack Form and Effect Schema as the form state and validation owners. The [earlier shadcn registry references](.impeccable/reference/shadcn-base-nova/SOURCES.md) remain historical source material.

Keep labels visible, place helper and error text beside the relevant field, and use one clear primary action. Controls support keyboard use with visible focus. Selected, focused, invalid, and disabled states remain visually distinct.

Field validation and service errors belong to the [error contract](.impeccable/onboarding-error-contract.md). Flow behavior belongs to the [transition contract](.impeccable/onboarding-transitions.md). The [implementation ledger](../../docs/plans/onboarding.md) tracks the work required to bring these designs into the application.
