---
name: impeccable
description: Design or visually refine a frontend surface; use a named critique, accessibility or styling technique when requested.
metadata:
  version: 4.3.1
---

# Interface design

Use the existing Impeccable engine and assets. Follow the web AGENTS.md, live
Paper design, and PRODUCT.md/DESIGN.md. Keep the agreed design when refining a
screen; a refinement request is not permission for a redesign.

Read the reference for the task, not every guide. Use
[new-work](reference/new-work.md) for a new screen and [shape](reference/shape.md)
for a planning-only brief. When a design is already agreed, implement and check it
without asking for another design workshop.

The launcher is `scripts/impeccable` relative to this skill (or `.cmd` on Windows).
Inspect setup effects before first use: it may download an engine and write a
cache. When useful, `context --target <path>` resolves tool context for a surface.
Reuse unchanged context; refresh it when the target or relevant inputs change.
If unavailable, read the actual PRODUCT.md/DESIGN.md and continue supported work;
missing tooling alone is not a new permission gate. Never fabricate live Paper access.

Check the screens, states, and device sizes affected by the change. Fix related
defects, repeat the affected checks, and complete the assignment. No fixed number
of concepts, reviewers, question rounds, or polish passes is required.
[Craft guidance](reference/craft-floor.md) offers techniques when needed; it is
not required reading before every small edit.

Keep the files, assets, schemas, and metadata the engine reads compatible.
Use doctor/hooks commands for requested tool maintenance. Loading this skill does
not require regenerating project context or adding another build phase.

## Commands

| Command | Category | Description | Reference |
|---|---|---|---|
| `craft [feature]` | Build | Deprecated alias for an ordinary new-work request | [reference/craft.md](reference/craft.md) |
| `shape [feature]` | Build | Plan UX/UI before writing code | [reference/shape.md](reference/shape.md) |
| `init` | Build | Capture durable product context in PRODUCT.md | [reference/init.md](reference/init.md) |
| `document` | Build | Generate DESIGN.md from existing project code | [reference/document.md](reference/document.md) |
| `extract [target]` | Build | Pull reusable tokens and components into design system | [reference/extract.md](reference/extract.md) |
| `critique [target]` | Evaluate | UX design review with heuristic scoring | [reference/critique.md](reference/critique.md) |
| `audit [target]` | Evaluate | Technical quality checks (a11y, perf, responsive) | [reference/audit.md](reference/audit.md) · native: [reference/audit.native.md](reference/audit.native.md) |
| `polish [target]` | Refine | Final quality pass before shipping | [reference/polish.md](reference/polish.md) |
| `bolder [target]` | Refine | Amplify safe or bland designs | [reference/bolder.md](reference/bolder.md) |
| `quieter [target]` | Refine | Tone down aggressive or overstimulating designs | [reference/quieter.md](reference/quieter.md) |
| `distill [target]` | Refine | Strip to essence, remove complexity | [reference/distill.md](reference/distill.md) |
| `harden [target]` | Refine | Production-ready: errors, i18n, edge cases | [reference/harden.md](reference/harden.md) |
| `onboard [target]` | Refine | Design first-run flows, empty states, activation | [reference/onboard.md](reference/onboard.md) |
| `animate [target]` | Enhance | Add purposeful animations and motion | [reference/animate.md](reference/animate.md) |
| `colorize [target]` | Enhance | Add strategic color to monochromatic UIs | [reference/colorize.md](reference/colorize.md) |
| `typeset [target]` | Enhance | Improve typography hierarchy and fonts | [reference/typeset.md](reference/typeset.md) |
| `layout [target]` | Enhance | Fix spacing, rhythm, and visual hierarchy | [reference/layout.md](reference/layout.md) |
| `delight [target]` | Enhance | Add personality and memorable touches | [reference/delight.md](reference/delight.md) |
| `overdrive [target]` | Enhance | Push past conventional limits | [reference/overdrive.md](reference/overdrive.md) |
| `clarify [target]` | Fix | Improve UX copy, labels, and error messages | [reference/clarify.md](reference/clarify.md) |
| `adapt [target]` | Fix | Adapt for different devices and screen sizes | [reference/adapt.md](reference/adapt.md) · native: [reference/adapt.native.md](reference/adapt.native.md) |
| `optimize [target]` | Fix | Diagnose and fix UI performance | [reference/optimize.md](reference/optimize.md) |
| `live` | Iterate | Visual variant mode: pick elements in the browser, generate alternatives | [reference/live.md](reference/live.md) |

For an explicit command, read its guide and stay within the assignment. For a
bare skill invocation, use [routing](reference/routing.md). A tool directive does
not grant approval, widen scope, or require a handoff. Keep the project's rule for
agreeing new designs, but do not ask again for agreement already given.