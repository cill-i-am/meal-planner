# Vision and scope

## Product promise

Meal Planner's promise is to reduce the repeated work of deciding what everyone
in a household will eat. It learns about the people, their routines, and their
constraints, proposes a complete week, makes it easy to change, and learns from
one week to the next.

The primary version-one promise is **less time spent planning**. Effort,
repetition, ingredient reuse, and light qualitative observations may influence
recommendations, but a generic nutrition or personal-goals system is outside the
MVP.

## Experience ambition

The conversation should do useful planning work, not sit around a form as an
extra interface. It should feel like working with a nutrition-aware family meal
planner who:

- understands the whole household rather than one generic user;
- notices routines, exceptions, conflicts, cooking capacity, and opportunities
  for leftovers;
- asks the next useful question instead of reading a fixed questionnaire;
- explains assumptions and trade-offs in ordinary language;
- creates visible, editable artifacts throughout the conversation;
- produces one fully personalised recommendation; and
- reaches a practical result quickly.

The experience must not claim to diagnose, treat, certify food safety, or replace
a qualified health professional. It may make transparent qualitative
observations without turning them into medical or calorie claims.

## Initial users

The first users are households in a small, invite-only beta. A household may
contain:

- adults with authenticated accounts;
- dependants represented by managed profiles without accounts; and
- adults represented as people before accepting an invitation and linking an
  account.

The product serves households, not general organizations. Better Auth may still
provide reusable account and organization management. Sports teams, workplaces,
and other groups are outside the first product.

## Core jobs

A household should be able to:

1. describe and repeatedly update each person's food preferences, constraints,
   portions, routines, and ordinary context;
2. establish recurring household and person-level meal patterns;
3. combine curated content with private household recipes, imports, assembled
   meals, and packaged products;
4. cover every managed person and meal occasion for the planning period;
5. minimize cooking and planning effort through shared meals, intentional
   leftovers, prepared components, external meals, and low-burden alternatives;
6. understand how routines, fallbacks, constraints, and capacity affected the
   recommendation;
7. review and revise the proposed plan conversationally or visually;
8. approve one shared household plan;
9. derive a consolidated retailer-neutral shopping list; and
10. optionally review the previous week so the next proposal requires less work.

## Version-one capability boundary

Version one includes:

- account, household, membership, person, and dependant setup;
- private, repeatable adult interview sessions;
- household-visible confirmed person profiles;
- broad adult edit and plan-approval permissions with audit history;
- AI-led person and household routine building;
- configurable meal occasions, locations, equipment, preparation windows, and
  cooking capacity;
- all managed meal occasions, including intentional skips, external meals, and
  flexible slots;
- a shared curated recipe catalogue;
- private household-created, imported, and adapted recipes;
- assembled meals and exact or generic packaged products;
- person-level exceptions and approved fallback repertoires;
- one fully personalised recommended week with visible rationale;
- cook events, finished portions, reusable prepared components, and planned
  allocation to later meals;
- lightweight prepared fridge/freezer stock without continuous pantry tracking;
- complete draft repair and revisioned approval;
- a consolidated retailer-neutral shopping list; and
- an optional weekly review and learning loop.

## Product principles

### Save work rather than manufacture it

Covering all meals must not mean scheduling a complicated recipe for every
person and every cell. Reusable routines, repeated simple meals, leftovers,
packaged foods, eating out, flexible slots, and intentional skips are valid and
often preferable outcomes. Ordinary use during the week must not require meal
confirmation.

### Account for everyone

The system accounts for the whole household. A shared meal can feed several
people, with a simple alternative for someone who needs one. The screen can
combine those details, but the plan must still account for each person.

### Make the agent useful and accountable

The agent should connect facts, anticipate problems, update affected parts of a
plan, and explain its choices. Adults must be able to inspect and edit its facts,
routines, assumptions, reasons, and significant proposed changes.

### Respect hard boundaries

Allergies, intolerances, explicit dietary constraints, and other hard rules are
validated outside model discretion. The agent may not override them to improve
a score or complete a plan.

### Prefer one practical preparation over two impressive recipes

Personalizing meals should reduce work. When a shared meal does not suit someone,
prefer an approved easy fallback, a variation using shared ingredients, an
assembled meal, packaged food, or a meal eaten elsewhere. Do not automatically
add another elaborate cooking session.

### Preserve truth and provenance

Imported recipe facts remain tied to evidence, confidence, review state, and
explicit unknowns. Missing quantities, yield, timing, or nutrition are not
silently invented. Plan rationale references confirmed product state rather
than private transcript text.

### Keep drafts reversible and active weeks stable

Profiles, routines, recipes, and plans remain editable and versioned. Weekly
plans are drafts until explicitly approved. An approved plan is never silently
rewritten; material changes create a visible proposed revision.

### Learn through exceptions

The product assumes the approved plan happened unless the household reports a
deviation. Weekly review is optional and valuable, not a gate or a daily
tracking obligation.

## Explicit non-goals for the initial beta

- retailer login, price scraping, product matching, offers, basket mutation,
  checkout, or payment;
- a complete continuously inferred ingredient pantry;
- food-safety use-by calculation, expiry automation, or safe-to-eat claims;
- calories, macros, generic weight or muscle goals, medical diagnosis,
  treatment, or prescribed therapeutic diets;
- dependant login or granular household permissions;
- a public user-contributed recipe marketplace;
- autonomous publication of imported recipes to the shared catalogue;
- MCP as the only or required consumer interface;
- embedded retailer journeys or white-label distribution;
- external calendar integration in the first vertical;
- generalizing the household domain to teams or workplaces; and
- optimizing for large numbers of anonymous households before the full household
  experience works.

## Definition of product success

Success means beta households approve useful, complete plans in less time, need
fewer corrections in later weeks, and return because the app remembers what works
for them. A good conversation matters because it helps reach that result. A long
conversation is not valuable by itself.