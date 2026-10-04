---
title: Use Transitions for Non-Urgent Rendering
impact: LOW
impactDescription: keeps urgent interactions responsive during expensive updates
tags: rendering, transitions, useTransition, loading, state
---

## Use Transitions for Non-Urgent Rendering

Use `useTransition` for non-urgent React rendering when it improves a measured
interaction. Keep controlled input updates synchronous. `isPending` describes a
Transition; it does not replace the query or mutation adapter's network state.

In this app, the feature's TanStack Query hook owns remote data, pending state,
errors and invalidation. Screens own drafts and navigation. Do not copy query
results into component state or hand-write a second request lifecycle to obtain
a Transition loading indicator. See [data ownership](../engineering/DATA_FLOW_AND_STATE.md).

React 19 supports async Transition actions, but state updates after `await` need
another `startTransition` to be marked as Transitions. Interruptible rendering
does not cancel a network request or guarantee async results arrive in order.
The operation owner must handle cancellation, ordering and failures explicitly.
An unknown command result still requires retry or reconciliation of the same
submitted command; interruption is not evidence that the server did not commit.

Reference: [React useTransition](https://react.dev/reference/react/useTransition).
