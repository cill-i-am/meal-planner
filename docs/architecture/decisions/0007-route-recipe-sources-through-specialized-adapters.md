# ADR-0007 — Route Recipe Sources Through Specialized Adapters

- Status: Accepted
- Date: 2026-08-26
- Related product decision: [PDR-0011](../../decisions/product/0011-recipe-url-import-and-source-routing.md)

## Context

The current recipe-import API accepts only `{ kind: "tiktok", url }`, and the
current `SourceResolver` accepts a `TikTokIdentity` and returns a resolved video
source. That implementation is appropriately specialized for TikTok media, but
it is not the correct global abstraction for arbitrary recipe URLs.

General web-page import needs different acquisition, security, canonicalization,
content parsing, and evidence semantics. Turning the existing TikTok resolver
into one large conditional service would mix unrelated provider logic and make
future source support increasingly fragile.

At the same time, creating a complete import workflow for every source family
would duplicate idempotency, workflow, review, recipe-admission, and household
authority behaviour.

## Decision

### Submitted and resolved source contracts

The external household submission contract is source-neutral for ordinary URL
imports, directionally:

```ts
type SubmittedRecipeSource =
  | { readonly kind: "url"; readonly url: SourceUrl }
  | { readonly kind: "manual" }
```

Source resolution produces a closed discriminated union that records the actual
adapter and source form, directionally:

```ts
type ResolvedRecipeSource =
  | ResolvedTikTokVideoSource
  | ResolvedTikTokCarouselSource
  | ResolvedRecipeWebPageSource
```

The implementing capability may refine names and fields. The architectural
boundary is that submitted intent and resolved source identity are different
contracts.

### Thin source router

A `RecipeSourceRouter` owns only source-family selection and dispatch.

- It validates and sanitizes the submitted HTTPS URL.
- It uses deterministic host and path rules for known dedicated source families.
- Known TikTok URLs route to the TikTok adapter.
- Other admitted public HTTPS URLs route to the generic recipe-web-page adapter.
- It does not run model extraction or contain provider-specific acquisition
  logic.
- It returns an explicit unsupported result when no adapter safely accepts the
  source.

The router may be implemented as a small registry or closed dispatch table. It
must not become a speculative plugin framework.

### Source adapter boundary

Each adapter owns the source-specific work needed before common recipe
draft extraction, including where applicable:

- URL normalization and canonical source identity;
- redirect handling within the admitted security policy;
- source metadata and attribution;
- media or page acquisition;
- source-form classification;
- evidence capture and source-specific provenance;
- classified acquisition failures; and
- cleanup of source-local transient resources.

Directionally:

```ts
interface RecipeSourceAdapter<Input, Resolved, Failure> {
  readonly resolveAndAcquire: (
    input: Input
  ) => Effect.Effect<Resolved, Failure>
}
```

The actual Effect service shape should remain as narrow as the implementation
needs. This ADR does not require one generic interface to erase useful
source-specific types.

### Existing TikTok resolver

- The current TikTok `SourceResolver` remains useful source-specific logic.
- During implementation it should be renamed, relocated, or wrapped so its
  TikTok-specific identity is explicit, for example `TikTokSourceResolver` or a
  service internal to `TikTokRecipeSourceAdapter`.
- It should not be widened to accept arbitrary URLs or return a weak common
  object with many nullable fields.
- Existing TikTok video and carousel behaviour remains behind the TikTok adapter
  while the external submission flow becomes generic.

### Generic recipe-web-page adapter

The web-page adapter owns restricted public-page acquisition.

- Network I/O occurs behind an SSRF-resistant fetch boundary with HTTPS-only
  policy, DNS and private-address checks, bounded redirects, timeout, response
  size, and content-type limits.
- User cookies, retailer sessions, browser credentials, and login state are not
  accepted.
- Structured recipe markup is parsed before optional evidence-grounded model
  extraction.
- Relevant visible-page content is captured and compared when readily and safely
  available.
- Complete, internally consistent structured markup may produce a draft when the
  visible card cannot be acquired reliably.
- Material structured-versus-visible conflicts are represented explicitly with
  field-level provenance and remain reviewable; neither source silently wins.
- Visible content may corroborate or fill supported omissions but cannot invent
  fields absent from the acquired evidence.
- A page without reliable recipe evidence returns unsupported or a truthful
  partial result; it never asks a model to manufacture a recipe from an arbitrary
  webpage.

The resolved web source and evidence manifest need enough structure to preserve,
at minimum:

- submitted and canonical URL;
- author or publisher attribution where available;
- structured recipe evidence;
- relevant visible-card evidence where captured;
- field-level provenance or evidence references;
- detected evidence conflicts; and
- acquisition and parsing limitations.

The exact robots and publisher-policy behaviour remains a delivery decision
before this adapter ships.

### Common downstream lifecycle

After an adapter returns a decoded resolved source and evidence manifest, the
existing common lifecycle owns:

- household-scoped import intent and idempotency;
- workflow orchestration and retries;
- evidence-grounded normalized draft extraction;
- review and correction;
- household recipe admission;
- immutable recipe versioning; and
- optional later catalogue-candidate publication through separate authority.

Source adapter or provider I/O never occurs inside a `HouseholdObject`
transaction. The household authority receives only closed decoded commands and
commits canonical product state and receipts.

### Canonical identity and deduplication

- Canonical source identity is namespaced by resolved source family so unrelated
  adapters cannot collide accidentally.
- Redirect and canonical URL observations come from the responsible adapter.
- Deduplication uses the canonical resolved identity, household scope, and the
  accepted import lifecycle rather than raw submitted URL text alone.
- A source being imported privately by one household does not publish or expose
  it to another household.

### Future adapters

A future source family is added when it genuinely needs different acquisition or
evidence semantics. It supplies a new resolved-source variant and adapter while
reusing the common import and review lifecycle.

The architecture does not require a new adapter for every website. Ordinary
recipe sites remain the responsibility of the generic web-page adapter until a
concrete source demonstrates the need for a specialized boundary.

## Consequences

- The public import experience can accept one URL without exposing source
  classification to the household.
- TikTok-specific code remains strongly typed rather than being diluted into a
  nullable universal resolver.
- Generic web acquisition gains an explicit high-risk network boundary.
- Structured markup is primary evidence, while visible-card evidence provides
  corroboration and conflict detection where available.
- Review contracts need field-level provenance and conflict representation.
- Common workflow, review, and household admission semantics remain shared.
- The source router stays thin and deterministic; model behaviour begins only
  after the system has captured admitted evidence.
- API and shared-contract changes will be required because the current protocol
  encodes TikTok as the only source kind.

## Alternatives Rejected

### Require the user to choose the source type

Rejected because the source is normally obvious to the system and exposing
adapter selection adds friction without household value.

### Turn the current TikTok `SourceResolver` into a universal resolver

Rejected because its input, output, failures, media session, and metadata are
correctly TikTok- and video-oriented. Widening it would produce a misleading
abstraction and a growing conditional implementation.

### Treat every URL as a generic webpage

Rejected because social-media video and carousel acquisition have materially
different canonicalization, evidence, provider, and failure semantics.

### Let a language model select the adapter

Rejected because routing is security- and acquisition-sensitive, can be decided
from deterministic source evidence, and should remain reproducible and cheap.

### Trust structured markup without comparison or provenance

Rejected because published markup can be stale, incomplete, or inconsistent
with the visible recipe. Structured data remains primary, but conflicts must be
visible and reviewable.

### Require visible-card extraction for every successful import

Rejected because complete structured recipe evidence can remain useful even when
client-rendered or otherwise difficult visible content cannot be captured
reliably.

### Build a separate workflow and review model per source

Rejected because source acquisition differs while recipe draft, review,
household admission, versioning, and planning authority should remain common.
