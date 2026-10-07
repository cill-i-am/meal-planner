---
name: Meal Planner
description: Bold, responsive interfaces within a professional planning conversation.
---

# Meal Planner design

Read [PRODUCT.md](PRODUCT.md) for the intended experience. Conversation is the primary interface. Useful questions and editable results appear within it, and the composition responds to the work in progress.

## Visual direction

Cillian selected these bold explorations as visual references for the conversational experience:

- [A37](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-G-0/A37-0) and [AAQ](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-G-0/AAQ-0) are the primary references.
- [A24](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-G-0/A24-0), [AE5](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-G-0/AE5-0), and [B7A](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-G-0/B7A-0) provide additional direction.

These references establish visual ambition. They are not approval of a complete flow. Inspect the referenced artboards before designing; unrelated or later canvas work does not supersede them automatically.

Use confident typography, strong contrast, generous space, and expressive food or household imagery where it helps the task. Give the current question or result a clear focal point. Adapt the composition to desktop and mobile without reducing desktop to an enlarged phone layout.

## Conversation and interaction

The service asks a purposeful question, offers a useful proposal, or helps revise a result. Render choices and controls when they make that exchange easier. Keep a person's words and the resulting changes visibly connected.

Let a substantial artifact, such as a proposed week, use the space it needs while remaining part of the conversation. Keep the composer accessible and preserve the thread when opening a detail. Avoid turning every message into a card or every internal state into a page.

Show what changed and what needs a decision. A draft, a pending save, a completed save, and an uncertain result need distinct feedback. Preserve edits and unresolved requests through recovery. These are interaction requirements; [feature contracts](../../docs/reference/features/README.md) own persistence and permissions.

Motion should explain an update, preserve orientation, or acknowledge an action. Keep controls stable during streaming and loading. Announce meaningful status changes, retain keyboard focus, and honour reduced motion. Sound remains optional and must never carry information alone.

## Existing designs and implementation references

Login, signup, and recovery are established work. Their [account entry](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-J-0), [additional states](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-K-0), and [transition contract](.impeccable/onboarding-transitions.md) remain references for maintenance. They do not set the layout for future planning conversations.

The [conversation-first family table](https://app.paper.design/file/01M2YNGSS3QW4T1ENVYSS0ZXNP/p-L-0) records family creation work. [Snapshots](.impeccable/snapshots/index.md) record dated designs, not the latest state of every flow. The [onboarding work](../../docs/plans/onboarding.md) records remaining acceptance checks.

Use existing shadcn and Base UI components, semantic OKLCH tokens, and Tailwind as required by [web instructions](AGENTS.md). The [reference theme](.impeccable/reference/shadcn-theme.css) and application styles own exact values; this document does not duplicate token tables or component specifications. Inter and Instrument Serif belong to the established visual vocabulary.

Preserve native focus, keyboard, dismissal, and form behaviour. [Form rules](../../docs/reference/forms.md), the [error contract](.impeccable/onboarding-error-contract.md), and the [shared component guide](src/components/ui/SHADCN.md) own those details. Every icon action has an accessible name and tooltip. Controls retain 44px targets and work with text enlargement.
