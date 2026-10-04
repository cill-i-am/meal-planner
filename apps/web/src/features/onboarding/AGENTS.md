# Family setup screens

Own presentation and route composition for family drafting, Members, and Confirmation. [SetupProvider](setup-provider.tsx) keeps `/setup/family` under the account provider while the reviewed roster saves, then composes the selected family provider for review, people, and confirmation. Put reusable family operations in the [family feature](../family/AGENTS.md).

The setup entry keeps a family table beside plain conversation. The account name fills the first place; typed roster proposals update the other places without opening a form. Corrections replace the displayed draft. Explicit conversational agreement binds to that exact block and revision, submits its stable action, completes setup and opens `/?area=tastes`. The conversation controller owns remote state, receipts and retained unknown actions. **Add manually instead** deliberately switches to the roster editor seeded with the current draft and existing family/people commands. A description is not a save; an unknown action needs an explicit retry with its original request identity, including after reload.

Manual family setup creates a real family and opens review. Members edits its saved roster. Continue opens Confirmation without completing setup. Confirmation's actions complete setup before leaving. The conversational path completes automatically after its committed receipt. URL search owns the selected family; saved setup status chooses a default entry, not a remembered screen.

Keep unsent form drafts local. React Activity preserves both setup presentations during mode switches; manual entry mounts on its first deliberate switch with the current table draft, then keeps its own unsent edits. Keep submitted uncertain requests in memory while mounted through [request recovery](../request-recovery/AGENTS.md). A GET must not repair creator linking: use the explicit resume operation offered by the review screen.

Read [the setup map](../../../../../docs/reference/features/auth-family/family-setup.md) for routes, labels, failure paths, and proof. Update it when navigation or visible actions change. Export route components through [index.ts](index.ts).

`SetupFrame` disables its controls until TanStack reports hydration. This covers SSR roster actions and logout as well as form submission; visible HTML alone does not mean its event handlers are attached.
