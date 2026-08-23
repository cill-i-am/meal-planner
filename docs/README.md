# Meal Planner Documentation

## Household Planning

- [Source of truth](source-of-truth.md)
- [Preferences and constraints](preferences-and-constraints.md)
- [Current approved week](current-week.md)
- [Weekly meal-planning workflow](meal-planning-workflow.md)
- [Meal feedback](meal-feedback.md)

`current-week.md` is the routing point for active plan and shopping-list files.
Drafts remain inactive until explicitly approved.

## Product And Engineering

- [Household product blueprint](product-blueprint/README.md)
- [Household domain boundary](architecture/household-domain.md)
- [Recipe import intent authority and lifecycle](architecture/recipe-import-intent.md)
- [TikTok recipe-import feasibility report](tiktok-recipe-import-feasibility.html)
- [Real-source recipe quality pilot runbook](real-source-pilot-runbook.md)
- [Real-source pilot input package](real-source-pilot-input-package.md)
- [Operator TikTok carousel bundle runbook](operator-carousel-import-runbook.md)
- [Tesco API facade](../apps/api/README.md)

The product blueprint owns accepted long-horizon household product direction.
Current technical boundaries remain in the architecture documents, while
non-trivial software product intent, readiness, blockers, and delivery state
live in Linear and should be read there at action time.

## Agent Workflow

- [Agent workflow documentation](agents/README.md)

The agent workflow docs define how Linear Projects and Issues move through
triage, isolated implementation, review, CI, and evidence-backed completion.