# Site-wide json-render

Status: proposed
Owner: unassigned
Depends on: [discovery and evaluation](private-discovery/03-adaptive-discovery-and-evaluation.md)

## Accepted direction


On 2026-09-08, the product owner accepted eventual site-wide adoption of
[json-render](https://json-render.dev/docs). Roll it out in stages after the
current discovery and evaluation work; no implementation date is set. The
destination is adoption across the site, beyond any initial meal-interface
prototype.

Build its component catalogue from Meal Planner's existing components. Generated
views and actions remain subject to server-owned permissions, domain validation,
and explicit confirmation requirements. Presentation does not become household
authority. Integration details belong to the later rollout work; this direction
does not start implementation or dependency installation now.


## Acceptance to refine when assigned

- [ ] Define the first bounded surface and evaluate integration with existing components.
- [ ] Preserve domain commands, server permission checks and explicit confirmation.
- [ ] Verify the actual UI and document subsequent rollout; do not call one prototype
  site-wide completion. No installation or application implementation occurs here.
