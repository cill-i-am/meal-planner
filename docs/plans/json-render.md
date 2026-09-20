# Use json-render across the site

Status: proposed
Owner: unassigned
Depends on: [discovery and evaluation](private-discovery/03-adaptive-discovery-and-evaluation.md)

## Accepted direction


On 2026-09-08, the product owner accepted eventual site-wide adoption of
[json-render](https://json-render.dev/docs). Roll it out in stages after the
current discovery and evaluation work; no implementation date is set. The
destination is adoption across the site, beyond any initial meal-interface
prototype.

Build its component catalogue from Meal Planner's existing components. The server still checks permissions, validates data and requires explicit confirmation for generated views and actions. A generated UI does not decide or overwrite household facts. Integration details belong to the later rollout work; this direction
does not start implementation or dependency installation now.


## Acceptance to refine when assigned

- [ ] Choose the first screen and check how json-render works with the existing components.
- [ ] Preserve domain commands, server permission checks and explicit confirmation.
- [ ] Check the working UI and record the next rollout steps. One prototype does not complete a site-wide rollout. No installation or application implementation occurs here.
