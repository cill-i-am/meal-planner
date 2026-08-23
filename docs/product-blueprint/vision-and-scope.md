# Vision and Scope

## Product Promise

Meal Planner removes the recurring mental load of deciding what every person in
a household will eat. It learns the household, turns routines and constraints
into a complete weekly food plan, makes the plan easy to revise, and improves
from week to week.

The primary version-one promise is **less time spent planning**. Nutrition,
budget, variety, waste, and personal goals may influence recommendations, but
they do not displace time saved as the main outcome.

## Experience Ambition

The AI-led experience is a product differentiator, not decorative chat around a
form. It should feel like working with an excellent nutrition-aware family meal
planner who:

- understands the whole household rather than one generic user;
- notices routines, exceptions, conflicts, and opportunities for leftovers;
- asks the next useful question instead of reading a fixed questionnaire;
- explains assumptions and trade-offs in ordinary language;
- creates visible, editable artifacts throughout the conversation; and
- reaches a practical result quickly.

The experience must not claim to diagnose, treat, or replace a qualified health
professional. It may help a user express goals and constraints while remaining
truthful about uncertainty and the source of its information.

## Initial Users

The first users are households in a small, invite-only beta. A household may
contain:

- adults with authenticated accounts;
- dependants without accounts; and
- adults who are represented as people before accepting an invitation and
  linking an account.

The product is designed for households, not generic organizations. Better Auth
may remain a reusable organization control plane, but sports teams, workplaces,
and other group types are outside the first product domain.

## Core Jobs

A household should be able to:

1. describe each person's food preferences, constraints, routines, and goals;
2. establish recurring household and person-level meal patterns;
3. combine curated recipes with private household recipes and imports;
4. cover every configured person and meal occasion for the planning period;
5. minimize cooking and planning effort through shared meals, intentional
   leftovers, and low-burden alternatives;
6. review and revise the proposed plan conversationally or visually;
7. approve one shared household plan;
8. derive a consolidated retailer-neutral shopping list; and
9. review the previous week so the next proposal requires less work.

## Version-One Capability Boundary

Version one includes:

- account, household, membership, and dependant setup;
- private adult interview sessions;
- household-visible confirmed person profiles;
- AI-led person and household routine building;
- all configured meal occasions, including intentional skips and eating out;
- a shared curated recipe catalogue;
- private household-created, imported, and adapted recipes;
- person-level exceptions and dependable fallback meals;
- cooking events, produced portions, and allocation to later meals;
- a complete draft plan with explicit unresolved coverage;
- shared review, revision, and approval;
- a consolidated retailer-neutral shopping list; and
- a lightweight weekly review and learning loop.

## Product Principles

### Save work rather than manufacture it

Covering all meals must not mean scheduling a complicated recipe for every
person and every cell. Reusable routines, repeated simple meals, leftovers,
eating out, and intentional skips are valid and often preferable outcomes.

### Account for everyone

The system reasons over the complete household. A shared meal may satisfy many
people at once, while one dependant may require a simple alternative. The
presentation can be compressed; the underlying coverage cannot be accidental.

### Make the agent impressive and accountable

The agent should synthesize, anticipate, and explain. It must also expose the
facts, routines, assumptions, and plan changes it proposes so users can inspect
and edit them.

### Respect hard boundaries

Allergies, intolerances, explicit dietary constraints, and other hard rules are
validated outside model discretion. The agent may not override them to improve
a score or complete a plan.

### Prefer one practical cook over two impressive recipes

Individualization should reduce household friction. When a shared meal does not
fit one person, the planner should prefer a safe, accepted, low-effort variation
or fallback over creating a second unrelated cooking burden.

### Preserve truth and provenance

Imported recipe facts remain tied to evidence, confidence, review state, and
explicit unknowns. Missing quantities, yield, timing, or nutrition are not
silently invented.

### Keep drafts reversible

Profiles, routines, recipes, and plans remain editable. Weekly plans are drafts
until explicitly approved, and meaningful revisions are auditable.

## Explicit Non-Goals For The Initial Beta

- retailer login, price scraping, product matching, offers, basket mutation,
  checkout, or payment;
- medical diagnosis, treatment, or prescribed therapeutic diets;
- a public user-contributed recipe marketplace;
- autonomous publication of imported recipes to the shared catalogue;
- MCP as the only or required consumer interface;
- embedded retailer journeys or white-label distribution;
- generalizing the household domain to teams or workplaces; and
- optimizing prematurely for fleet-wide anonymous scale before the household
  loop is proven.

## Definition Of Product Success

The product is succeeding when beta households approve useful complete plans in
less time, make fewer corrections over successive weeks, and return because the
system remembers how their household actually works. A delightful conversation
matters because it should produce that result more accurately and with less
friction, not because conversation length is valuable by itself.