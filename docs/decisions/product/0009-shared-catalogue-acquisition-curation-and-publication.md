# PDR-0009 — Shared Catalogue Acquisition, Curation, And Publication

- Status: Accepted
- Date: 2026-08-25
- Owners: Household product

## Context

Meal Planner needs a useful shared recipe catalogue before the invite-only beta,
but acquiring a recipe candidate is not the same as curating and publishing a
trusted product asset. Bulk ingestion is an efficient way to create candidates;
it is not permission to expose every extracted recipe to households.

The product also has two deliberately different content domains:

- a shared catalogue available across households; and
- private household recipe banks containing household imports, manual recipes,
  forks, and adaptations.

Those domains must not leak into one another merely because they share recipe
normalization and planning contracts.

## Decision

### Initial catalogue target

- The initial catalogue should contain roughly `100–200` high-quality active
  recipes and meal options.
- This is a directional starting target rather than a permanent maximum or an
  invented hard beta gate.
- The catalogue is selected for planning usefulness: breakfasts, lunches,
  dinners, simple meals, portable food, batch cooks, different effort profiles,
  useful leftovers, and a practical range of dietary patterns.
- A smaller trustworthy catalogue is preferable to a larger bank with weak
  quantities, scaling, effort, or suitability data.

### Operator-managed bulk acquisition

- The catalogue may be bootstrapped by collecting a larger batch of promising
  source links and submitting them through the existing import pipeline.
- TikTok links are the initial expected bulk source, but the candidate model is
  source-neutral.
- Processing several hundred links to obtain roughly `100–200` publishable
  recipes is an acceptable operating model.
- Bulk ingestion creates private catalogue **candidates** only. A successful
  extraction does not make the recipe visible in the shared catalogue.
- Duplicate, incomplete, low-value, unreliable, or poorly evidenced candidates
  may be rejected without affecting household recipe banks.

### Review and publication gate

Before a candidate becomes shared catalogue content, the curator reviews the
facts that make it usable for planning, including where applicable:

- source and attribution provenance;
- the rights or permission basis required by the accepted publication policy;
- ingredients, quantities, instructions, and base yield;
- scaling behaviour and unresolved quantities;
- effort, equipment, preparation windows, portability, and leftover use;
- suitability and dietary metadata without unsupported health claims;
- shopping-demand completeness; and
- whether the candidate adds useful coverage rather than duplicating existing
  content.

Publication is an explicit, audited transition that creates or activates an
immutable catalogue recipe version. Model output, extraction success, household
approval, or operator review preparation cannot publish implicitly.

### MVP publication authority

- Cillian is the sole shared-catalogue curator and publication authority for the
  MVP.
- Only that operator authority may publish, correct, activate, retire, or restore
  shared catalogue versions.
- Being a household adult, household owner, or recipe importer does not confer
  catalogue publication authority.
- The product may provide a small authenticated admin interface for candidate
  review and publication. The UI calls the same typed, audited catalogue
  commands as any other operator surface and is not itself the authority.
- Multi-curator roles and delegated publication are deferred.

### Household recipe banks

- Each household retains its own private recipe bank.
- A household may import, review, approve, version, and use recipes within that
  household without affecting the shared catalogue.
- Household content is never automatically submitted or projected into the
  shared catalogue.
- Editing a shared catalogue recipe creates a private household fork according
  to PDR-0004; it does not mutate the global recipe.
- Ordinary households cannot publish globally in the MVP.

### Catalogue updates and household adoption

- A catalogue correction creates a new immutable version under the same stable
  catalogue recipe identity.
- Existing approved or historical plans remain pinned to the exact version they
  used. A catalogue update never rewrites an active or historical household
  plan.
- Where a household merely references, favourites, or routinely selects a
  catalogue recipe without forking it, future plan generation uses the latest
  active catalogue version by default.
- A household may explicitly preserve an older catalogue version by forking that
  version into its private household bank.
- Existing household forks remain unchanged when the source catalogue recipe is
  corrected. They are household-owned versions and are never automatically
  rebased or overwritten.
- The product may notify a household that the source catalogue recipe has a newer
  version and show a human-readable difference.
- A household may selectively adopt useful changes into its fork through an
  explicit household recipe edit that creates a new immutable household version.
- Retiring a catalogue version prevents new default selection where policy
  requires it, but does not invalidate plans or household forks that already pin
  that version.

### Versioning and history

- Shared catalogue recipes use stable recipe identity and immutable versions.
- Plans pin the exact catalogue or household recipe version used.
- Publication, correction, activation, retirement, restoration, and household
  adoption are auditable.
- Version selection for future planning is explicit and reproducible: latest
  active catalogue version for an unforked catalogue reference, or the pinned
  household version for a fork.

## Consequences

- The product needs a distinct catalogue-candidate lifecycle and explicit
  publication command, not a Boolean on the household import path.
- Bulk ingestion and shared publication are separate capabilities even where
  they reuse the same extraction and review contracts.
- Operator authorization must be explicit and narrower than household
  membership.
- An admin UI is useful but optional; the durable authority is the catalogue
  command boundary and audit history.
- Candidate volume may exceed active catalogue size by design.
- Rights and attribution review cannot be bypassed by technical extraction
  success.
- Catalogue reads must distinguish stable recipe identity, latest active
  version, and an exact historical version.
- Household forks need source-version ancestry and an explicit selective-adoption
  flow rather than automatic rebasing.

## Deferred

- delegated or multi-curator publication;
- ordinary household contribution to the global catalogue;
- automated catalogue publication;
- a public recipe marketplace;
- retailer-funded or branded catalogue content;
- the exact licensing and attribution policy for each source class; and
- automatic rebasing or forced migration of household forks onto later catalogue
  versions.
