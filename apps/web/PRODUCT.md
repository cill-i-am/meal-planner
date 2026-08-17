# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TanStack Start with React, TanStack Query, TanStack Form, Better Auth, Effect Schema, app-local shadcn primitives, and the generated `@meal-planner/recipe-import-api` Effect HttpApi client.

## Users

A household meal planner importing one public TikTok recipe link at a time while working at a kitchen table or on a phone.

## Product Purpose

Provide household-scoped sign-up, login, and setup, then prove that one public recipe link can become a truthful canonical import intent, a reviewable generated action, and one saved Recipe without exposing an API credential or provider data to the browser.

## Operating Context

The user pastes a link, sees the admitted intent immediately, watches its plain-language processing stages, checks the generated recipe review, edits its name when the canonical action permits it, and explicitly confirms it before the saved Recipe is shown.

## Capabilities and Constraints

- One TikTok HTTPS URL per attempt.
- Better Auth owns email/password identity, sessions, organizations, and membership in a dedicated D1 database.
- The browser uses the canonical generated Effect HttpApi client against its own origin. Native same-origin cookies authenticate requests; the browser sends no bearer credential and contains no copied API DTOs.
- The public Website Worker raw-proxies auth and application API requests to the private API Worker through a Cloudflare service binding.
- No direct TikTok, AI, Cloudflare, Tesco, basket, checkout, payment, publication, or external-message effects occur in this web workspace.
- No recipe corrections/editor, saved-recipe browser, batch flow, realtime behavior, or end-user deployment support is included.

## Evidence on Hand

This is a provider-free proof at the real Worker/D1 seams. It proves local account, cookie session, household organization and membership authorization plus canonical intent/action/recipe handling; it does not prove live media acquisition, transcription, extraction quality, or deployed production access.

## Product Principles

- Tell the truth about progress and failure.
- Require review before saving.
- Keep secrets and evidence-heavy provider data on the server.
- Prove one complete path before generalizing.

## Accessibility & Inclusion

Keyboard-operable controls, visible focus, named form fields and status regions, 44px targets, responsive document layout, and reduced-motion support are required.
