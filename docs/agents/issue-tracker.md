# Repository planning configuration

Plans and implementation tasks live in [docs/plans](../plans/README.md), using
the [existing documentation standard](../reference/documentation.md). This is the
configured local Markdown tracker for Matt's skills. Use the active plan for the
approved outcome; a small task can use its request and PR without another file.

When `to-spec` says publish, create or update that plan with the existing template,
status and owner. When `to-tickets` says publish, record independently deliverable
slices in that plan; use linked child plans only when separate ownership or size
justifies them. Keep blocking dependencies explicit. Do not create a parallel
`.scratch` tracker, GitHub issue queue or triage-label system.

Fetch a referenced task by reading its plan and linked decisions. Take a ready,
unblocked slice within the assigned scope; mark its actual progress in the owning
plan. Implementation detail and ticket granularity do not reopen approved product
direction. A request to work a specific GitHub issue still uses that issue.

Review the current PR against the approved request and plan. Derive its comparison
base from the actual PR or branch ancestry; ask only when competing interpretations
would materially change the review. Keep the user request available as the spec
when no separate document is warranted.
