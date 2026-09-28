# Food profile reference slice

Status: active
Owner: current implementation branch
Base: `origin/main` at `03c701b`

## Outcome

A family organizer can complete setup, add a household-visible food preference,
correct it, and see the saved result after reload. This provides a post-setup
reference journey while preserving the existing profile contract, storage,
permissions, version ledger, and explicit safety confirmation.

## Ownership

The [food profile intent map](../reference/food-profile-intent-layer.md) records
the package, server feature, host adapter, and web feature boundaries. The web
feature owns query state, mutation recovery, and cache invalidation. The screen
owns person selection and fact forms. Private interviews only consume the
feature's public interface when they need a current profile.

## Acceptance

- [x] Cross-feature imports use public feature entrypoints at the changed seams.
- [x] Browser component tests preserve exact-command recovery, stale-version
  handling, safety confirmation, and saved cache updates.
- [x] A Playwright page-object journey covers setup, save, correction, reload,
  and authoritative profile read in the local Worker runtime.
- [x] Type, lint, formatting, documentation, and affected behavior checks pass.
- [ ] Review and hosted checks pass before merge. No deployment is implied.

## Local verification

On the implementation branch, the web TypeScript check, changed-file lint and
format checks, documentation link check, and reference boundary test passed.
Vitest browser mode passed 46 focused component tests. The full local Playwright
suite passed 22 journeys in desktop Chromium and mobile WebKit against the
Website/API Workers and their storage. These checks do not select a production
model or prove live email delivery.

## Limits

This slice does not select an AI model, complete the private-discovery quality
evaluation, or change profile domain rules. Those tasks remain with the
[private discovery plan](private-discovery/README.md).
