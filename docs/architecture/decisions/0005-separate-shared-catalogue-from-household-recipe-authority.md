# ADR-0005 — Separate Shared Catalogue From Household Recipe Authority

- Status: Accepted
- Date: 2026-08-25
- Related product decision: [PDR-0009](../../decisions/product/0009-shared-catalogue-acquisition-curation-and-publication.md)

## Context

Meal Planner needs recipes that are visible to every household and recipes that
remain private to one household. The existing `HouseholdObject` is the canonical
per-household authority for private imports, reviews, recipes, plans, and related
product state. Turning it into a fleet-wide catalogue query surface would break
that isolation model, while projecting private household banks into a shared
store would create an accidental publication channel.

Bulk import also produces untrusted or incomplete candidates. Candidate
acquisition, curation, publication, and household use have different authority
and lifecycle requirements.

## Decision

### Separate global catalogue authority

- The shared curated catalogue has an explicit global product authority separate
  from every `HouseholdObject`.
- The exact Cloudflare primitive and persistence layout belong to the
  implementing work item; this ADR fixes the authority boundary rather than a
  particular database choice.
- Catalogue authority owns candidate publication state, stable catalogue recipe
  identities, immutable catalogue versions, active or retired lifecycle, curator
  audit, and global read access for admitted household planning.
- Only the operator authority accepted in PDR-0009 may execute catalogue
  publication and lifecycle commands in the MVP.

### Household authority

- `HouseholdObject` remains canonical for private household imports, review,
  household recipe identities and versions, household forks, household meal
  options, plans, feedback, and shopping demand.
- Household approval publishes only into that household's private bank.
- A household fork records ancestry to the catalogue recipe and version but
  becomes household-owned state.
- No fleet-wide projection, crawler, or read model may discover private
  household recipes and turn them into catalogue candidates without a separate
  explicitly accepted contribution capability.

### Candidate acquisition

- Operator-managed bulk imports may reuse source acquisition, extraction,
  evidence, and review contracts from the existing import system.
- Catalogue candidates remain private operator state until an explicit
  publication command succeeds.
- Successful extraction, candidate review preparation, or provider completion
  does not imply catalogue publication.
- Provider and source I/O occur outside catalogue publication transactions.

### Household reads and plan pinning

- Household planning may query active catalogue versions through a closed,
  read-only catalogue boundary.
- Selecting a catalogue recipe for a plan records the immutable recipe version
  or a safe planning snapshot sufficient to preserve the approved plan.
- A later catalogue update cannot silently rewrite an active or historical
  household plan.
- There is no distributed transaction between catalogue publication and a
  household plan. The household command validates and pins the catalogue version
  it actually consumed.

### Admin surface

- A future admin UI is a client of typed catalogue candidate, review, and
  publication commands.
- UI authentication alone is not catalogue authority; the server command
  boundary admits the product-owner curator principal and records audit.
- The same command contracts must support deterministic tests and operator-free
  fixtures without weakening production authorization.

## Consequences

- The system gains a global catalogue capability in addition to per-household
  product authority.
- Catalogue publication, candidate review, and household recipe admission are
  separate workflows even where they reuse schemas or extraction services.
- Catalogue reads need bounded, versioned contracts suitable for planning and
  discovery.
- Household isolation remains physical and conceptual: private recipe banks are
  not the source of a global catalogue projection.
- Cross-authority failure is handled through immutable version references and
  ordinary retries, not dual writes or an atomic transaction spanning catalogue
  and household state.

## Alternatives Rejected

### Store the shared catalogue in one designated HouseholdObject

Rejected because a household-scoped authority should not own global product
content or global curator policy.

### Copy the entire catalogue into every household

Rejected because it duplicates authority and storage, complicates corrections,
and creates version drift across households.

### Build the catalogue as a projection of all household recipes

Rejected because private household content must not become globally visible by
accident, and household approval is not publication consent or curation.

### Publish directly from bulk import success

Rejected because extraction success does not establish recipe completeness,
planning quality, source rights, attribution, or curator approval.

### Let the admin UI write catalogue tables directly

Rejected because the user interface is not an authority boundary and would
bypass typed commands, audit, replay, and invariant enforcement.
