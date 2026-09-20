---
name: impeccable
description: Design or visually refine a frontend surface; use a named critique, accessibility or styling technique when requested.
metadata:
  version: 4.3.1
---

# Interface design

This is the repository's task adapter for the existing Impeccable engine/assets.
Follow the owning web AGENTS.md, live Paper design and current PRODUCT.md/DESIGN.md.
The brief and agreed visual system govern; refinement does not authorize redesign.

Use the reference for the actual question below, not every playbook. For new
surfaces use [new-work](reference/new-work.md); for a planning-only brief use
[shape](reference/shape.md). On an already agreed design, continue implementation
and relevant browser verification without another concept/approval workshop.

The launcher is `scripts/impeccable` relative to this skill (or `.cmd` on Windows).
Inspect setup effects before first use: it may download an engine and write a
cache. When useful, `context --target <path>` resolves tool context for a surface.
Reuse unchanged context; refresh it when the target or relevant inputs change.
If unavailable, read the actual PRODUCT.md/DESIGN.md and continue supported work;
missing tooling alone is not a new permission gate. Never fabricate live Paper access.

Choose design checks for the changed surface/states and actual device sizes. Fix
in-scope defects, rerun affected checks and continue to the assigned endpoint.
No compulsory number of concepts, review roles, question rounds or polish passes.
[Craft guidance](reference/craft-floor.md) supplies relevant design techniques,
not a mandatory reading step before every small edit.

Keep required tool inputs, assets, schemas and metadata compatible. Explicitly
requested tool maintenance can use doctor/hooks commands; do not bulk-regenerate
project context or introduce build-phase state just because the skill was loaded.

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


For an explicit command, use its reference within the task's scope. A bare skill
invocation can use [routing](reference/routing.md). A skill or tool directive does
not invent approval, additional scope or a mandatory handoff. Project-specific
new-design agreement remains meaningful; reuse agreement already obtained.
