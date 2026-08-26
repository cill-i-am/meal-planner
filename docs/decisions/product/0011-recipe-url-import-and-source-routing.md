# PDR-0011 — Recipe URL Import And Source Routing

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Context

A household should not need to understand the acquisition architecture before
importing a recipe. The ordinary interaction is simply pasting a URL. The system
may receive a TikTok video, TikTok carousel, public recipe page, or another
supported source later, but source-specific acquisition must not create separate
product journeys or separate recipe-review semantics.

The current implementation and public contract are TikTok-specific. General
recipe-page import therefore needs an explicit product boundary rather than
adding unrelated URL logic throughout the existing workflow.

## Decision

### One ordinary URL-import interaction

- The normal household import flow accepts one absolute HTTPS recipe-source URL.
- The household is not required to choose `TikTok`, `recipe website`, or another
  technical source type before submission.
- The system classifies the submitted URL and routes it to the appropriate
  source adapter.
- Manual recipe entry remains a separate explicit authoring flow because it has
  no acquired source evidence.
- Operator bulk ingestion may submit many URLs, but each item uses the same
  per-source routing, acquisition, evidence, review, and publication contracts as
  a single household import.

### Source routing

- Known source families use dedicated adapters. TikTok is the first dedicated
  adapter.
- An ordinary public web URL that does not belong to a known dedicated source is
  offered to the generic recipe-web-page adapter.
- Routing uses deterministic URL and acquired-content evidence. A language model
  does not guess which acquisition adapter should receive a URL.
- A dedicated adapter may refine the source into a more specific resolved kind,
  such as TikTok video or TikTok carousel.
- Adding a later source such as YouTube, Instagram, or another structured recipe
  provider means adding an adapter rather than creating another recipe-review
  lifecycle.

### Public recipe-page boundary

The MVP web-page adapter supports one intentionally submitted public recipe page
at a time.

- The page must be reachable without a user login, copied browser cookies,
  paywall bypass, or custody of third-party credentials.
- The adapter follows only admitted safe redirects and applies the platform's
  restricted outbound-fetch policy.
- It prefers structured recipe data where present and may use relevant visible
  page content as evidence.
- It retains the submitted and canonical URL plus reliably available author or
  publisher attribution.
- It produces the same evidence-grounded recipe draft and unresolved-field model
  used by other sources.
- It does not crawl the surrounding site merely because one recipe URL was
  submitted.
- Multi-page, highly interactive, inaccessible, or unsupported sources either
  produce a truthful partial draft where captured evidence supports one, or fail
  with an explicit unsupported or unavailable result.
- Missing quantities, yield, timings, or instructions are never invented to make
  an unsupported page appear successful.

The exact robots policy, structured-versus-visible evidence requirements, and
support for unusual multi-page recipe experiences remain implementation
questions to resolve before the web adapter ships.

### Common import lifecycle

After source-specific acquisition and evidence production, every supported
source converges on the same product lifecycle:

```text
submit URL
  → classify and route
  → acquire source-specific evidence
  → normalize a provenance-backed recipe draft
  → review and correct
  → approve into the household bank
  → optionally publish through the separate catalogue-curator flow
```

- Source kind and canonical identity remain attached for provenance,
  idempotency, deduplication, and support.
- Source-specific evidence may differ, but approved recipe and planning
  semantics do not depend on whether the source began as TikTok or HTML.
- A household import remains private to that household by default.
- Only the separate operator-only catalogue flow may publish a reviewed recipe
  globally.

### Failure semantics

- An unsupported source fails honestly rather than being treated as a generic
  web recipe by default.
- A generic web page with no reliable recipe evidence is not promoted to a
  recipe merely because an extraction model can produce plausible text.
- Redirect, fetch, content-type, size, and parsing failures remain classified and
  retryable only where the underlying condition is genuinely transient.
- The user can review partial evidence and unresolved fields where useful, but
  review cannot convert absent source facts into falsely extracted facts.

## Consequences

- The household UI can provide one low-friction paste-a-link action.
- The public source contract needs a generic submitted-URL form and a distinct
  resolved-source union.
- TikTok acquisition remains specialized, while generic recipe-page acquisition
  gets its own security and parsing boundary.
- Import orchestration, review, recipe admission, and household privacy remain
  shared rather than duplicated per source.
- Batch catalogue acquisition and single household imports exercise the same
  source adapter contracts.

## Deferred

- logged-in or paywalled source acquisition;
- browser-extension or cookie-assisted import;
- whole-site crawling;
- automatic import from named social-media saved collections;
- support for every video, social, PDF, image, or document source;
- the exact robots and publisher-policy implementation for generic web pages;
- multi-page recipe navigation beyond a proven need; and
- autonomous publication of any imported source into the shared catalogue.
