# Init flow

`init` captures durable product truth in PRODUCT.md. It does not invent a visual world and does not write DESIGN.md; [new-work.md](new-work.md) creates or expands one, and [document.md](document.md) records an incumbent one. Existing runnable web projects may also receive `.impeccable/live/config.json`.

## Step 1: Load current state

Use the PRODUCT.md path resolved by `impeccable context`. Update it instead of creating a competing authority. In a child app inheriting root context, resolve shared versus app-specific scope from the request and repository before writing.

- **No PRODUCT.md:** explore the supplied brief and repository, resolve material gaps, and write it.
- **PRODUCT.md exists:** update stale or missing facts within the assignment; preserve confirmed fields.
- **Legacy PRODUCT.md:** add only durable missing facts; absent `## Platform` means `web` unless evidence says otherwise.
- **Only DESIGN.md exists:** leave it untouched and create PRODUCT.md.
- **Redesign/rebrand request:** preserve confirmed product truth unless the user changes it. Visual replacement happens later in new-work, not here.

Never silently overwrite an existing file or offer DESIGN.md during init. If another request invoked init, finish PRODUCT.md and resume it. New visual work continues in new-work; `shape` resumes its assigned brief.

## Step 2: Explore the project

Before asking, scan enough to avoid making the user repeat known facts: product docs and copy; package/config and app boundaries; features, workflows, routes, and roles; names, logos, legal/proof assets, and brand commitments; platform/accessibility signals; and the dev command/entry when live mode applies.

Treat repository evidence as a hypothesis, not user approval. Note visual maturity without documenting, extending, or replacing the world.

Form a platform hypothesis: `web`, `ios`, `android`, or `adaptive` (one product that genuinely adapts its design language per OS). Mobile web remains `web`; a native wrapper around a website does not make its design language native.

## Step 3: Resolve material product gaps

Reuse the request, agreed plan, existing product records and source evidence.
Ask only when an unresolved audience, purpose, platform, brand commitment or
accessibility decision materially changes the result. Use the host's actual
question tool when suitable; no interview round is required for a complete brief.
Continue independent work while a real decision remains open.

When the stack is absent, use the user's stated preference or delegated choice;
ask only if its consequences constrain the requested outcome. Record the chosen
stack and rationale. Label uncertain facts and open decisions rather than
inventing users, claims or approval. An unanswered optional question does not
require probing the user again.

### What belongs here

- users, jobs, workflows, purpose, success, positioning, and operating context;
- capabilities, constraints, terminology, evidence, platform, and accessibility;
- confirmed voice, assets, and brand commitments.

### What does not belong here

- visual worlds, palettes, typography, components, or page concepts;
- visitor mode, narrative, CTA/proof sequence, or other surface strategy;
- invented testimonials, customers, benchmarks, pricing, licensing, or deployment claims;
- a requirement to decide every optional field.

## Step 4: Write PRODUCT.md

Write only confirmed facts and explicitly marked open decisions. Omit irrelevant sections rather than filling them with generic prose.

```markdown
# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
[Greenfield only: the user's answer to the stack question, e.g. "static HTML/CSS", "Astro", or "delegated: <what you chose and why>". Omit the section when an existing codebase already answers it.]

## Users
[Primary users, their situation, and job. Add other audiences only when confirmed.]

## Product Purpose
[What the product does, why it exists, and what success means.]

## Positioning
[The product mechanism or claim a neighboring product could not truthfully copy.]

## Operating Context
[Workflows, environments, tools, documents, materials, and rituals that are factual parts of using or evaluating the product.]

## Capabilities and Constraints
[Confirmed functionality, technical constraints, terminology, and explicitly undecided product facts.]

## Brand Commitments
[Existing name, voice, assets, personality, identity constraints, and references the user explicitly made binding. Omit when none exist.]

## Evidence on Hand
[Real content, data, demonstrations, testimonials, case studies, press, or assets, with paths where applicable. State absences that future work must not fabricate.]

## Product Principles
[Three to five durable strategic principles derived from confirmed answers; no visual recipes.]

## Accessibility & Inclusion
[Known user needs or required standard. Omit when no product-specific requirement was established.]
```

Platform is the bare value `web`, `ios`, `android`, or `adaptive`. Preserve useful legacy headings. New files go at `PROJECT_ROOT/PRODUCT.md`; otherwise update the resolved file. Write it before any visual-world or surface-concept work.

Copy the `impeccable:product-schema` comment verbatim, including when you update an older file. It records which version of the product record this file follows, so later versions can tell a deliberately short record from one written before a section existed, and never propose an interview the user has already sat through. Update the number only when this reference's template changes it. Remove retired sections within authorized context maintenance, preserving any still-useful facts in their supported home.

When the platform you just recorded is `ios`, `android`, or `adaptive`, load [ios.md](ios.md), [android.md](android.md), or both before any design work. On a project that had no PRODUCT.md, `impeccable context` could not know the platform and so never loaded them; init is the only place that learns the answer.

### Completion gate

Before loading new-work or resuming shape/build, verify that PRODUCT.md exists at the resolved path and contains the confirmed product record. If the file is absent, init is incomplete. Do not substitute interview notes, a planning packet, or later design prose for the file.

## Step 5: Preserve tool settings

Keep existing `.impeccable/config.json` and local overrides compatible. A stored
`buildPath` remains a tool preference; it does not replace the repository's Paper
design authority or require a comp tournament. Record a new durable preference
only when the user actually chooses it or authorizes setting it. Init can finish
with the setting unset.

Configure live mode only when useful to the assignment: skip native or
non-runnable projects and preserve existing config. Follow [live.md](live.md)'s
setup when needed, respecting the actual authorization for any CSP source edit.

## Step 6: Wrap up or resume

Summarize captured and deliberately undecided facts. Do not offer DESIGN.md merely because it is missing.

Recommend the next action from the actual project state:

- Empty or early project: resume the assigned surface, or use `$impeccable shape <surface>` for a planning-only request. New-work establishes a visual world only when needed.
- Existing coherent interface without DESIGN.md: `$impeccable document` if the user wants the incumbent system recorded independently of a new build.
- Existing surface needing work: name the most relevant scoped command.
- Web project ready for visual iteration: `$impeccable live` when configured.

If init was invoked by another request, resume without rerunning `impeccable context`; the native reference above is the one thing that run could not have given you, and new-work owns later visual decisions.
