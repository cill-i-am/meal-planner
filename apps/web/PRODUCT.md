# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TanStack Start with React, TanStack Query, TanStack Form, Effect Schema, and app-local shadcn primitives. This proof is localhost-only and unsupported for deployment.

## Users

A household meal planner importing one public TikTok recipe link at a time while working at a kitchen table or on a phone.

## Product Purpose

Prove that one public recipe link can become a truthful processing flow, a reviewable draft, and exactly one approved Recipe Bank result without exposing provider credentials to the browser.

## Operating Context

The user pastes a link, watches plain-language processing stages, checks the extracted recipe, and explicitly approves it before anything appears in Recipe Bank.

## Capabilities and Constraints

- One TikTok HTTPS URL per attempt.
- A deterministic localhost fake API stands in for the production-shaped import endpoints.
- API credentials and the API base URL remain server-only; the base URL must be loopback.
- No live TikTok, AI, Cloudflare, Tesco, basket, checkout, payment, publication, or external-message effects.
- No recipe corrections, recipe-bank browser, batch flow, auth platform, realtime behavior, deployment support, or backend changes.

## Evidence on Hand

This is a provider-free proof against a deterministic local HTTP service. It does not prove live media acquisition, transcription, extraction, production routing, or production access control.

## Product Principles

- Tell the truth about progress and failure.
- Require review before saving.
- Keep secrets and evidence-heavy provider data on the server.
- Prove one complete path before generalizing.

## Accessibility & Inclusion

Keyboard-operable controls, visible focus, named form fields and status regions, 44px targets, responsive document layout, and reduced-motion support are required.
