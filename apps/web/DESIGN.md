---
name: Meal Planner
description: Calm family setup with a soft pastel glow and focused forms.
---

# Meal Planner design

## Overview

[Paper is the source of truth for the visual design](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-1-0). This document records the onboarding design reviewed on 20 September 2026. Check the relevant live screens, states, and tokens before adding or changing UI. The working rules are in [AGENTS.md](AGENTS.md).

The application uses a white surface with a diffuse lilac, blue, rose, and peach gradient behind the upper content. Grey filled fields, primary-colored links, pastel avatars, and black pill buttons complete the theme. Keep the task easy to scan. Brand details support the form without adding extra steps or explanatory copy.

shadcn provides the component structure, behavior, and semantic token conventions. The Meal Planner theme gives those components the appearance shown in Paper.

This baseline covers login, signup, family setup, people, invitations, and password recovery. See [the snapshot index](.impeccable/snapshots/index.md) for desktop and mobile references and [the surface brief](.impeccable/onboarding-shape.md) for scope and product decisions.

## Colors

The [reference theme](.impeccable/reference/shadcn-theme.css) records the agreed values and their shadcn mapping. It is not imported by the application. Read live Paper tokens when checking or extending the design, then update this reference if an agreed value changes.

| Role | Tokens | Baseline value |
| --- | --- | --- |
| Application surface and primary-button text | `background`, `primary-foreground` | `#FFFFFF` |
| Main text, primary actions and links | `foreground`, `primary` | `#111114` |
| Filled fields and secondary surfaces | `muted`, `secondary` | `#F4F4F6` |
| Supporting text | `muted-foreground` | `#65656F` |
| Soft accent surface | `accent` | `#F0ECFA` |
| Pastel background light | `glow-lilac`, `glow-blue`, `glow-rose`, `glow-peach` | `#ECE3F8`, `#DEEFFB`, `#F7E4F0`, `#FAEBDD` |
| Focus | `ring` | `#245BCE` |
| Invalid input and error text | `destructive` | `#9B2431` |
| Separators | `border` | `#E9E9ED` |
| Field and selected-segment boundary | `input` | `#858591` |

Auth navigation uses shadcn Button’s link variant and inherits `primary`, including the signup header. Keep a visible gap between the header prompt and “Log in”. This replaces the earlier blue auth-link treatment.

Use `foreground` on secondary and accent surfaces. Keep a visible input boundary; the light field fill alone does not identify the control clearly. Use error text as well as color. Avatar pastels identify people without implying status.

## Typography

Use Inter with a system sans-serif fallback. Use regular text for content, medium text for action labels, and semibold text for headings. Headings use tight tracking (`-0.025em`).

The following sizes are the reviewed baseline. Sizes are font size / line height.

| Role | Desktop | Mobile |
| --- | --- | --- |
| Routine task heading | 36px / 40px | 28px / 32px |
| Welcome or completion emphasis, where shown in Paper | 48px / 52px | 32px / 36px |
| Body | 16px / 24px | 16px / 24px |
| Input text | 14px / 20px | 16px / 24px |
| Labels, actions, helpers, and errors | 14px / 20px | 14px / 20px |

Keep headings short and task-specific. Use **family** in product copy. Remove introductions that repeat the heading or describe an obvious interaction. Preserve copy that explains an invitation, privacy choice, password requirement, or recovery action.

## Layout

Signup is a standalone account-creation screen. Do not show an Account / Family / People progress stepper on signup, including validation states. This was agreed and applied to the desktop and mobile Paper screens on 21 September 2026.

Onboarding uses a centered form column with left-aligned routine content and one primary action. The desktop form is 432px wide. The 390px mobile reference has a 342px form and 24px side insets. Keep width fluid below those limits; let long content scroll.

The white application surface fills the browser viewport on desktop and mobile. Sky wallpaper, outer window framing, and phone status bars belong to the mockup presentation. The reference breakpoint is 768px. The main spacing steps are 8px, 10px, 12px, 16px, 20px, and 24px. Group each label, control, and helper; use larger gaps between tasks and sections.

Keep form actions before supporting lists on long mobile screens. Let the layout grow with errors, longer text, and text enlargement.

## Elevation and motion

Use the diffuse pastel gradient and fine separators to establish depth within the white application surface. The gradient fades to white around its edges and below the upper content. Keep routine form content directly on that surface. Selected segments use a white surface and visible boundary. Focus and validation halos communicate interaction state rather than decoration.

Paper shows the static gradient. The [motion study](.impeccable/reference/onboarding-motion.html) demonstrates a 42-second alternating drift with at most 1.5% translation and 2.5% scale. Animate only the decorative layer; keep content and controls still. Pause while a field is focused, when the page is hidden, or when the surface is offscreen. Reduced motion keeps the full static gradient. The [motion reference](.impeccable/reference/onboarding-motion.md) records the Ceird source and implementation boundary.

The [component reference](.impeccable/snapshots/overview/component-states.webp) shows default, focus, invalid, disabled, loading, hover, and pressed examples. A focused segment has a solid `ring` edge plus a 3px translucent halo. The invalid group has a destructive outline and halo.

## Shapes

Primary actions use a pill radius. Fields and the segmented track use a 12px radius; segments use 9.6px. The reference theme also defines a 7.2px small radius. Main inputs, buttons, and segments are 44px high. The segmented track is 52px high, including padding.

Give secondary actions such as **Show**, **Edit**, and **Save & exit** a minimum 44px target without increasing their visible text. Single-selection choices use a segmented control.

## Components

Use shadcn Input, Button, Field, FieldLabel, FieldDescription, FieldError, Alert, Avatar, Separator, and ToggleGroup as applicable. The [saved registry references](.impeccable/reference/shadcn-base-nova/SOURCES.md) identify the component baseline. The reference CSS defines the explicit Meal Planner theme overrides.

Keep labels visible, place helper and error text beside the relevant field, and use one clear primary action. Controls support keyboard use with visible focus. Selected, focused, invalid, and disabled states remain visually distinct.

Field validation and service errors belong to the [error contract](.impeccable/onboarding-error-contract.md). Flow behavior belongs to the [transition contract](.impeccable/onboarding-transitions.md). The [implementation ledger](../../docs/plans/onboarding.md) tracks the work required to bring these designs into the application.
