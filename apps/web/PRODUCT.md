# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TanStack Start with React, TanStack Query, TanStack Form, Better Auth, Effect Schema, app-local UI primitives, and generated Effect HttpApi clients. The existing codebase and `package.json` own implementation details.

## Users

Adults managing food for a whole household, including other adults and dependants with different preferences, routines, and dietary constraints. The job is to make a practical week of food work with less deciding, coordinating, cooking, and shopping effort.

The initial audience is Ireland-first households in a small, invite-only beta, beginning with dogfood and a closely supported pilot. Dependants have managed profiles rather than accounts. Adults may be represented in the household before accepting an invitation and linking an account.

## Product Purpose

Meal Planner is an AI-native household food service. It learns how the household eats and lives, proposes one practical personalised week, and turns an approved plan into consolidated shopping demand. Supermarket fulfilment is a later part of the full vision.

Success means less active planning time, fewer substantive corrections over successive weeks, and households returning because the service remembers what works for them. Beta targets are evaluation gates, not demonstrated performance claims; their owner is [PDR-0015](../../docs/decisions/product/0015-invite-only-beta-cohort-and-learning-cadence.md).

## Positioning

The service combines private discovery, confirmed household knowledge, routines, food content, and deterministic feasibility checks to produce one personalised recommendation. It accounts for shared meals, person-specific alternatives, leftovers, cooking capacity, existing food, and exceptions. The AI-led conversation produces visible, editable artifacts and reaches a useful result quickly.

## Operating Context

Use spans phones and larger screens, household setup, weekly planning, cooking, and shopping. Work, school, childcare, packed lunches, travel, eating out, and changing preparation time are ordinary planning inputs.

The intended journey is:

1. Set up the household, its adults, and its dependants.
2. Complete private adult discovery, correct proposed facts, and explicitly confirm what becomes part of the shared household profile.
3. Establish routines, fallback meals, and food content, including reviewed imports into the household Recipe Bank.
4. Review one feasible household week with understandable rationale and visible person-specific exceptions; revise it and explicitly approve it.
5. Use the consolidated retailer-neutral shopping list and, in later delivery, explicitly approved supermarket actions.
6. Optionally review exceptions from the week so future proposals require less effort. Ordinary use must not require daily meal confirmation.

## Capabilities and Constraints

### Current implementation

The web app provides household account/setup flows, people and dependant management, invitations, versioned food profiles, private adult discovery with reviewable profile cards and explicit confirmation, and evidence-grounded recipe import. Discovery includes application-owned required coverage and adaptive questioning; broader model-quality evaluation and conversation-tone work remain pending. Import currently accepts one public TikTok HTTPS URL per attempt.

An early meal-plan backend and a read-only Tesco catalogue facade exist in the repository. Their existence does not establish a complete planning or shopping experience in the web app. Live deployment and beta readiness are not established by this record. [Current delivery](../../docs/delivery/current.md) owns changing implementation status and acceptance evidence.

### Planned experience and release boundaries

The full product includes routines and fallbacks, curated and household food content, a feasible recommended week, repair and revisioned approval, prepared food and leftover allocation, a collaborative retailer-neutral shopping list, and optional weekly learning. These are accepted direction, not all implemented capabilities.

Supermarket product matching, pricing, availability, basket creation, checkout, and payment are beyond the initial beta. Medical or clinical nutrition, calorie and macro tracking, continuous pantry inference, food-safety certification, dependant login, public recipe marketplaces, and generic organization management are outside that release.

### Durable boundaries

- AI proposes; deterministic application code validates and commits. Hard dietary and suitability constraints remain outside model discretion.
- Private transcripts remain private to the participating adult. Confirmed, household-visible facts provide planning authority and rationale.
- One canonical household authority owns product state. UI projections and supermarket adapters do not become competing sources of household intent.
- Adults explicitly approve plans. Material changes to an approved plan require a visible proposed revision; approval is never inferred from a preview.
- Retailer adapters consume approved retailer-neutral demand. Basket creation, checkout, payment, and other external mutations require explicit approval.
- Imported facts retain evidence, provenance, and explicit unknowns. Missing quantities, yield, timing, or nutrition must not be invented.
- Browser requests use generated clients and same-origin authentication. Keep provider credentials and raw private provider evidence out of the browser and product copy.

## Brand Commitments

The current product name is Meal Planner. Explain questions, assumptions, trade-offs, progress, and failures in ordinary language. The service should act like an attentive, nutrition-aware family meal planner without making medical, therapeutic, or food-safety claims.

## Evidence on Hand

This record summarizes the confirmed product direction for interface work. Detailed product meaning and accepted decisions remain in the [product blueprint](../../docs/product-blueprint/README.md) and [product decision records](../../docs/decisions/product/). Consult those owners when a design changes product semantics, privacy, authority, or release scope.

- [Vision and scope](../../docs/product-blueprint/vision-and-scope.md) establish users, purpose, capabilities, and non-goals.
- [Experience blueprint](../../docs/product-blueprint/experience-blueprint.md) describes the intended household journey.
- [PDR-0013](../../docs/decisions/product/0013-plan-projection-rationale-and-experience-experimentation.md) establishes plan comprehension, progressive rationale, and experimentation boundaries without freezing a layout.
- [Current delivery](../../docs/delivery/current.md) links implementation, local runtime evidence, and remaining evaluation obligations.
- [Open decisions](../../docs/product-blueprint/open-decisions.md) owns unresolved choices, including model/provider strategy and future acquisition policy.

No customer testimonials, measured time-saving claims, pricing, or public launch claims are established here. Synthetic examples must be labelled as such; private household data and discovery transcripts are not promotional assets.

## Product Principles

- Save household work: prefer useful routines, shared preparation, leftovers, and low-effort alternatives over elaborate plans that create more labour.
- Account for everyone while presenting one understandable household week.
- Make the AI accountable through visible facts, assumptions, rationale, and editable proposals.
- Preserve privacy, hard constraints, provenance, and explicit approval.
- Keep drafts reversible and approved weeks stable; learn through optional feedback rather than daily tracking obligations.

## Accessibility & Inclusion

Keyboard-operable controls, visible focus, named form fields and status regions, 44px targets, responsive document layout, and reduced-motion support are required. Preserve these established requirements throughout discovery, review, confirmation, and future planning flows.
