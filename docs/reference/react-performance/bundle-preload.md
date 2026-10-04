---
title: Preload Based on User Intent
impact: MEDIUM
impactDescription: reduces perceived latency for likely next interactions
tags: bundle, preload, user-intent, hover
---

## Preload Based on User Intent

Preload a heavy bundle before a likely interaction when the delay is visible.
Prefer the router's existing preload mechanism for routes. Keep preload failures
with that owner; a failed speculative load must leave the actual action able to
retry or show its normal error state.

For a custom import triggered by hover or focus, explicitly handle rejection.
Do not initialize a module or start remote work merely because its bundle was
preloaded. Initialization needs an owner, cleanup and a failure path. Avoid eager
feature-flag effects that start work before the user needs it.

A `typeof window` guard prevents browser-only code from executing on the server.
It does not by itself prove that an imported module is excluded from the server
bundle. Verify emitted bundles when bundle size is the reason for the change.

See [dynamic imports](bundle-dynamic-imports.md) and
[async ownership](../engineering/ASYNC_AND_WORKFLOWS.md#promise-ownership).
