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
- It retains the submitted and canonical URL plus reliably available author or
  publisher attribution.
- It produces the same evidence-grounded recipe draft and unresolved-field model
  used by other sources.
- It does not crawl the surrounding site merely because one recipe URL was
  submitted.
- Missing quantities, yield, timings, or instructions are never invented to make
  an unsupported page appear successful.

### Structured and visible evidence

- Structured recipe data, normally JSON-LD or equivalent recipe-card markup, is
  the primary extraction source when present.
- The adapter captures and compares the relevant visible recipe card when that
  content is readily and safely available.
- Complete, internally consistent structured data may still produce a draft when
  the visible card cannot be extracted reliably.
- Visible page content may fill supported omissions or provide corroborating
  evidence, but it does not silently overwrite conflicting structured data.
- A material conflict between structured and visible evidence is preserved and
  surfaced for review with field-level provenance.
- Where neither source provides reliable recipe evidence, the adapter returns an
  unsupported result or a truthful partial draft rather than asking a model to
  construct a plausible recipe.
- Model extraction operates only over captured admitted evidence and cannot turn
  absent source facts into confirmed recipe facts.

### MVP rendering boundary and future escalation

- The MVP supports a self-contained recipe page that can be acquired and parsed
  without driving a real browser through a site-specific interaction flow.
- A recipe split across several pages, hidden behind a slideshow, dependent on
  repeated client interaction, embedded in an inaccessible application, or
  obscured by interstitials that prevent reliable capture remains unsupported or
  produces only the truthful partial draft supported by acquired evidence.
- The MVP does not run browser automation merely to close cookie banners, ads,
  pop-ups, or other overlays.
- This boundary is deliberate for implementation simplicity, predictable cost,
  acquisition reliability, and security.
- A later browser-rendered acquisition path, including a Cloudflare
  Browser Rendering based adapter or adapter mode, may be introduced when real
  failed-import evidence shows that the additional coverage justifies its
  runtime cost and operational complexity.
- Browser rendering would remain behind the recipe-web-page adapter boundary and
  converge on the same evidence, review, and admission lifecycle. It would not
  weaken the separate rule against logins, copied cookies, paywall bypass, or
  third-party credential custody without a superseding decision.

The exact robots and publisher-policy behaviour and restricted-fetch limits
remain implementation questions to resolve before the web adapter ships.

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
- Structured markup is the primary web evidence without becoming an
  unquestioned authority when the visible recipe disagrees.
- Field-level provenance and conflict state must survive into recipe review.
- The MVP does not need a browser-automation dependency or browser-runtime cost
  to support the ordinary recipe-page path.
- A future browser-rendered implementation can improve acquisition coverage
  without changing household import, review, or recipe authority semantics.
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
- browser-rendered acquisition, pop-up dismissal, and site interaction until
  observed failed-import coverage justifies them;
- multi-page recipe navigation beyond a proven need; and
- autonomous publication of any imported source into the shared catalogue.
