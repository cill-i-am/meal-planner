# PDR-0011 — Import a recipe by pasting its URL

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Decision and reason

Importing means supplying one absolute HTTPS recipe URL. Do not require users to
choose a technical source type. Route known source families through dedicated
adapters, starting with TikTok; route other ordinary public URLs to a generic
recipe-page adapter. Classification uses deterministic URL/acquired-content
evidence, not a model guess. Manual authoring is separate because it has no
acquired evidence. Bulk imports reuse the same per-item contracts.

Dedicated adapters may refine sources, such as TikTok video/carousel. All
supported sources converge on evidence-grounded draft, correction, review and
household approval, with separate operator-only global publication. Preserve
submitted/canonical source identity for provenance, deduplication, idempotency and
support. Source kind cannot change recipe authority or household privacy.

## Public pages and evidence

Support one intentionally submitted public recipe page, without login, copied
cookies, credentials or paywall bypass. Follow only admitted redirects through
restricted acquisition and retain reliable attribution. Do not crawl surrounding
sites or invent missing yield, quantities, timings or instructions.

Prefer structured recipe data such as JSON-LD, comparing the visible recipe card
when safely available. Complete consistent structured evidence can produce a
draft when the visible card cannot be captured. Visible evidence may fill supported
omissions but never silently overwrite conflicts. Preserve material conflicts and
field provenance for review. Model extraction uses only captured admitted evidence.
Absent facts remain absent; useful truthful partial drafts are acceptable.

The MVP handles self-contained pages without browser-driven site interactions.
Multi-page/slideshow recipes, inaccessible apps and interaction/interstitial-
blocked content remain unsupported or partial. Do not add browser automation to
dismiss ads/popups. This bounds cost, complexity and security exposure.

A later Browser Run path may be justified by actual failed-import evidence. It
stays behind the same adapter and review boundary and does not authorize logins,
cookie copying, credential custody or paywall bypass. Robots/publisher policy and
restricted-fetch limits remain implementation decisions required before shipping.

Unsupported sources and unreliable generic pages fail honestly. Classify redirect,
fetch, content-type, size and parsing failures; retry only genuinely transient
conditions. Review can correct a recipe but cannot falsely label absent facts as
extracted. Household imports remain private; only curator publication shares them.

Logged-in acquisition, browser extensions, crawling, social saved-collection
imports, universal media/document coverage, multi-page navigation and autonomous
publication remain deferred.
