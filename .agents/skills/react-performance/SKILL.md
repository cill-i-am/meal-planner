---
name: react-performance
description: Diagnose React rendering, data-fetching, hydration, or bundle performance when a measured problem or credible hot path needs investigation.
---

# React performance

Establish the slow interaction or expensive work before changing code. Use the
[reference index](references/README.md) to select only the relevant examples.
Treat them as conditional techniques, not a checklist for every component.

Measure the original problem again after the change. Keep an optimization only
when it helps, and preserve request isolation, access checks, and state ownership.
Check version-sensitive advice against the installed React and framework APIs.
Use [TanStack routing](../tanstack-routing/SKILL.md) for router and loader mechanics
and [coding standards](../coding-standards/SKILL.md) for this project's boundaries.
