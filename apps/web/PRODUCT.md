# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TanStack Start with React, TanStack Query, TanStack Form, Effect Schema, app-local shadcn primitives, and the generated `@meal-planner/recipe-import-api` Effect HttpApi client.

## Users

A household meal planner importing one public TikTok recipe link at a time while working at a kitchen table or on a phone.

## Product Purpose

Prove that one public recipe link can become a truthful canonical import intent, a reviewable generated action, and one saved Recipe without exposing an API credential or provider data to the browser.

## Operating Context

The user pastes a link, sees the admitted intent immediately, watches its plain-language processing stages, checks the generated recipe review, edits its name when the canonical action permits it, and explicitly confirms it before the saved Recipe is shown.

## Capabilities and Constraints

- One TikTok HTTPS URL per attempt.
- The canonical generated Effect HttpApi client is composed server-side; runtime API base URL and bearer credential are read only by server functions and the credential remains redacted.
- The browser uses server functions and canonical schemas only. It sends no upstream route/header/credential and contains no handwritten HTTP client or copied API DTOs.
- No direct TikTok, AI, Cloudflare, Tesco, basket, checkout, payment, publication, or external-message effects occur in this web workspace.
- No recipe corrections/editor, saved-recipe browser, batch flow, auth platform, realtime behavior, end-user deployment support, or backend changes are included.

## Evidence on Hand

This is a provider-free web proof at the API seam. It proves canonical intent/action/recipe handling and a server-only generated-client boundary; it does not prove live media acquisition, transcription, extraction quality, production access control, or end-user deployment readiness.

## Product Principles

- Tell the truth about progress and failure.
- Require review before saving.
- Keep secrets and evidence-heavy provider data on the server.
- Prove one complete path before generalizing.

## Accessibility & Inclusion

Keyboard-operable controls, visible focus, named form fields and status regions, 44px targets, responsive document layout, and reduced-motion support are required.
