# Meal Planner

Meal Planner is an AI-native household food service. It learns how a household eats and lives, creates a practical personalised week, and turns the approved plan into a supermarket shop.

A useful shorthand is **AI-native HelloFresh**. The goal is similar—remove the work of deciding and buying meals—but Meal Planner does not prescribe a fixed box. It adapts to the household's people, routines, preferences, dietary constraints, schedules, cooking capacity, leftovers, existing food, and exceptions.

## Product promise

Meal Planner should help a household:

- understand each person's food needs and preferences;
- plan around work, school, childcare, travel, and eating-out routines;
- create one complete, editable weekly food plan;
- prefer shared meals, leftovers, prepared components, and low-effort alternatives;
- explain why the plan was chosen and what each person's exceptions are;
- approve the plan before it becomes active;
- derive a consolidated, retailer-neutral shopping list; and
- use supported supermarket integrations to find products, prepare a basket, and eventually purchase food with explicit household approval.

The product plans for the whole household, not for one generic user.

## Core experience

1. An adult completes a private food and lifestyle review.
2. Meal Planner proposes structured profile facts and follow-up questions.
3. The adult corrects and confirms the facts they want to share.
4. Confirmed profiles become household-visible and auditable.
5. The system combines profiles, routines, recipes, packaged food, leftovers, and external meals.
6. Meal Planner creates one feasible weekly plan.
7. Adults revise and approve the plan.
8. The approved plan becomes retailer-neutral shopping demand.
9. A supermarket adapter translates that demand into products and, where supported, a basket or purchase flow.

The household plan remains the source of truth. Supermarket integrations provide catalogue, availability, pricing, basket, and purchase capabilities; they do not own household intent.

## Trust and authority

- Private transcripts remain private to the participating adult.
- AI output cannot directly write household state.
- Confirmed profiles, routines, plans, approvals, and shopping demand use typed, validated commands.
- Hard dietary and suitability constraints cannot be overridden by model output.
- Approved plans are not silently rewritten; material changes create visible revisions.
- Commands are versioned, audited, and safe to retry after a lost response.
- Basket creation, checkout, payment, and other external mutations require explicit user approval.

## Implementation status

The repository provides the foundations and early vertical slices:

- Better Auth household identity, membership, invitations, people, and dependants;
- versioned and auditable household food profiles;
- private adult discovery sessions with profile cards and explicit confirmation;
- evidence-grounded recipe importing into a household Recipe Bank;
- an early deterministic meal-plan backend built from approved recipes; and
- a read-only Tesco catalogue facade.

The full weekly planning, routines, shopping-list collaboration, supermarket basket, and purchasing experience remain outside the implemented scope. The web experience focuses on household setup, private discovery, profile management, and recipe import.

## Product boundaries

The first release does not include:

- a medical or clinical nutrition system;
- a calorie, macro, weight, or muscle-goal tracker;
- a continuously inferred pantry or food-safety system;
- a fixed meal-box subscription;
- a public recipe marketplace;
- retailer basket, checkout, or payment integration in the first release; or
- a generic organisation-management product.

The first product must prove that it can reduce household planning effort before it expands into broader retailer fulfilment or scale operations.

## Start here

- [Source of truth](docs/source-of-truth.md)
- [Product vision and scope](docs/product-blueprint/vision-and-scope.md)
- [Experience blueprint](docs/product-blueprint/experience-blueprint.md)
- [Current delivery](docs/delivery/current.md)
- [Household domain architecture](docs/architecture/household-domain.md)
- [Recipe import architecture](docs/architecture/recipe-import-intent.md)
- [Current approved week](docs/current-week.md)
- [Weekly workflow](docs/meal-planning-workflow.md)
- [Meal feedback](docs/meal-feedback.md)
- [Preferences and constraints](docs/preferences-and-constraints.md)
- [Current 6-day meal plan](docs/current-6-day-meal-plan.md)

## Origin

The initial context came from Louise's latest WhatsApp message linking to the shared Gemini chat:

- Short link: <https://share.gemini.google/v5KbmQbXq4bp>
- Canonical Gemini share: <https://gemini.google.com/share/4b24c5a8eaf6>
- Gemini chat title: "Family Meal Plan Creation"
- Published: June 21, 2026 at 6:29 PM

## Development

This repo is now a pnpm monorepo.

- API app: `apps/api`
- Web app: `apps/web`
- Run dev server: `pnpm dev`
- Typecheck: `pnpm check`
- Test: `pnpm test`
- Build: `pnpm build`

The API contains the Cloudflare Worker composition for household state, private discovery, and recipe imports, plus an Effect v4 beta Node service that exposes a typed read-only Tesco facade. Runtime configuration is read from the process environment through Effect Config; the app does not load `.env` files or provide runtime fallbacks.

GraphQL-backed Tesco routes need the current browser-derived Tesco values:

- `TESCO_MANGO_API_KEY`
- `TESCO_AUTHORIZATION`
- `TESCO_AUTH_COOKIE_HEADER`
- `TESCO_SOFT_REFRESH_SIGN_IN_URL`
- `TESCO_AUTH_REFRESH_FROM_URL`

The auth session refreshes by using Tesco's soft login URL with `prompt=none`, carrying the supplied cookie header through redirects, and reading the renewed authorization from the returned discover config.
