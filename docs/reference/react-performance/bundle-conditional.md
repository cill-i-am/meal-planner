---
title: Conditional Module Loading
impact: HIGH
impactDescription: loads large modules only when needed
tags: bundle, conditional-loading, lazy-loading
---

## Conditional Module Loading

Load a large module when its feature is activated, using the existing route
splitting or component loading boundary. Keep pending and failure presentation
with that owner. If custom async loading can outlive a mounted component or its
inputs, prevent stale completion from changing current state and handle rejection.

Loading a bundle and initializing a resource are different operations. Give
initialization explicit cleanup and cancellation rules; do not use an import
effect to start unowned background work.

A browser runtime guard does not establish server bundle exclusion. Verify the
build output when that is the intended optimization. See
[dynamic imports](bundle-dynamic-imports.md) and
[preloading](bundle-preload.md).
