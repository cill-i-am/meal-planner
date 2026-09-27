# Family setup screens

Own presentation and route composition for Name, Members, and Confirmation. [SetupProvider](setup-provider.tsx) composes the public account and family providers. Put reusable family operations in the [family feature](../family/AGENTS.md).

Name submits creation of a real family. Members edits its saved roster. Continue opens Confirmation without completing setup. Confirmation's actions complete setup before leaving. URL search owns the selected family; saved setup status chooses a default entry, not a remembered screen.

Keep unsent form drafts local. Preserve submitted uncertain requests through [request recovery](../request-recovery/AGENTS.md). A GET must not repair creator linking: use the explicit resume operation offered by the review screen.

Read [the setup map](../../../../../docs/reference/features/auth-family/family-setup.md) for routes, labels, failure paths, and proof. Update it when navigation or visible actions change. Export route components through [index.ts](index.ts).
