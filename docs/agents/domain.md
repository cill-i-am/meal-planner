# Domain Docs

Use domain docs to preserve product intent that should outlive one issue or PR.

## Where Durable Intent Lives

- Software product goals and accepted behavior live in the live Linear Project
  or PRD document.
- `../source-of-truth.md` owns durable household meal-planning intent.
- `../preferences-and-constraints.md` owns enduring household preferences,
  dietary constraints, and shopping conventions.
- `../current-week.md` owns the route to the currently approved plan and
  shopping list; drafts do not become active without explicit approval.
- Architecture decisions with long-term consequences should get an ADR or
  durable doc.
- Repo instruction rules live in `AGENTS.md` at the nearest semantic scope.
- Feature-specific facts can live beside the feature when they are only useful
  there.

## Domain Doc Rules

- Keep household meal-planning intent distinct from the recipe-import software
  product, while linking them where approved recipes or plans cross the
  boundary.
- Keep product language separate from implementation chores.
- Name the user, actor, or system boundary involved.
- Record constraints and rejected alternatives when they explain future
  choices.
- Preserve provenance, confidence, and unresolved uncertainty for imported
  recipe facts; do not invent missing quantities, timings, yield, or nutrition.
- Keep domain terms stable. Rename terms deliberately across docs, code, and
  issues.

## Avoid

- turning every small code change into an ADR
- burying durable product decisions only in PR comments
- copying the same intent across multiple docs
- treating an unapproved draft plan, basket, checkout, or external message as
  authorized
