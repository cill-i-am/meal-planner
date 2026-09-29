# Family setup screens

Own presentation and route composition for family drafting, Members, and Confirmation. [SetupProvider](setup-provider.tsx) keeps `/setup/family` under the account provider while the reviewed roster saves, then composes the selected family provider for review, people, and confirmation. Put reusable family operations in the [family feature](../family/AGENTS.md).

The setup entry accepts a natural-language family description and shows a typed roster proposal for local editing before the user selects **Create our family**. The agent action owns the accepted proposal and its canonical save progress. **Set up without chat** uses the same roster editor and existing family/people commands. A description is not a save, and an unknown action is retried with its original request identity.

Family setup creates a real family. Members edits its saved roster. Continue opens Confirmation without completing setup. Confirmation's actions complete setup before leaving. URL search owns the selected family; saved setup status chooses a default entry, not a remembered screen.

Keep unsent form drafts local. Keep submitted uncertain requests in memory while mounted through [request recovery](../request-recovery/AGENTS.md). A GET must not repair creator linking: use the explicit resume operation offered by the review screen.

Read [the setup map](../../../../../docs/reference/features/auth-family/family-setup.md) for routes, labels, failure paths, and proof. Update it when navigation or visible actions change. Export route components through [index.ts](index.ts).

`SetupFrame` disables its controls until TanStack reports hydration. This covers SSR roster actions and logout as well as form submission; visible HTML alone does not mean its event handlers are attached.
