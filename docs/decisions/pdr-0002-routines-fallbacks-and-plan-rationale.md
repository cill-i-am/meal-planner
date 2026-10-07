# PDR-0002 — Routines, fallback meals, and reasons for a plan

- Status: Accepted
- Date: 2026-08-24
- Owners: Household product

## Decision and reason

Households rely on dependable repeated food and limited cooking capacity. Apply
those patterns before recommending one coherent week; do not make adults repair
a generic recipe calendar.

Begin with breakfast, lunch, dinner and snacks. Households may add, rename,
disable or scope occasions by person and day. A versioned person or household
routine expands into a period's entries. It may specify exact food or an
approved set with pin, prefer or rotate behaviour, leftovers, external meals,
skips, context, preparation windows, portions and capacity. Approved plans pin
the routine version and expansion; later edits affect future periods by default.

## Routine conflict precedence

1. Hard suitability, dietary and safety constraints always win.
2. A compatible one-off period exception overrides a recurring routine.
3. A person routine overrides the household routine for that person.
4. The household routine supplies the remaining baseline.
5. Approved personal fallbacks repair incompatible or strongly avoided shared meals.
6. Ordinary preferences affect ranking without overriding confirmed routines.
7. Agent proposals require adult acceptance before gaining authority.

Apply an unambiguous compatible result automatically in drafts and make its real
reason inspectable. Equally specific conflicts require adult resolution. Stale
routine edits fail against the current version; never silently use last-write-wins.

Location, availability, equipment and preparation windows must be practical. A
slow cooker helps only when someone can start it. Cooking capacity is an explicit
household target that the agent may propose changing but cannot silently alter.
Effort includes hands-on and elapsed time, attention, cleanup, coordination,
advance preparation and skill. Friendly effort labels are derived summaries.

## Fallbacks and preferences

Fallback approval belongs to a person and may specify context, priority,
substitution policy and active or paused state. There is no fixed repertoire
limit. A fallback is a selection reason, not a food kind; it may reuse shared
components, be assembled, packaged, cooked or external.

- Incompatibility requires compatible alternative coverage. A strong avoid
  normally gets an approved fallback, with adult override. Ordinary dislikes
  lower ranking without automatically requiring a separate meal.
- Apply approved fallbacks in drafts without asking every time. Week approval
  includes its personal alternatives. Show relevant choices without requiring
  adults to manage the entire repertoire each time.
- A replacement must be active, compatible and applicable. Repair affected
  portions, effort, cook events and shopping together.
- Adults may pause unavailable fallbacks or products. Never silently replace an
  exact-only product. Use another approved option, propose one, or leave the gap
  visible. A proposed fallback can be used once, saved for future use or rejected;
  a proposed routine can apply this period, recur or be rejected.
- If no credible option exists, expose a gap or propose an explicitly accepted
  flexible slot rather than invent food.

Preferences may concern ingredients, dishes or cuisines, with optional occasion
or routine context. Suitability, preference and fallback reliability are distinct.
Exact products can appear by name before retailer integration. Substitution is
exact-only, ask-first or similar-products-acceptable.

Respect personal daily, weekday, weekly, fortnightly, make-again-soon, paused or
avoid cadence. Dependable repeated food must not lose to an abstract variety
score. Rationale identifies confirmed facts, people, routines, fallbacks,
locations or capacity that actually affected the recommendation, never private
transcript text. Adults can make focused changes to the recommended week.

Retailer availability, a universal child-food taxonomy, a general preference
rules language and unconfirmed permanent routines or fallbacks remain deferred.
Presentation may group shared meals and personal exceptions without exposing
internal domain records.
