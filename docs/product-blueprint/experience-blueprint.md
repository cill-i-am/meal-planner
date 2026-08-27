# Experience Blueprint

## Experience Thesis

Meal Planner should feel like a thoughtful household planning session that
happens to produce structured product state. The agent is not a decorative chat
box and the UI is not a questionnaire disguised as a conversation.

The best experience combines:

- an unusually perceptive natural conversation for discovery and revision;
- visible editable artifacts for trust and speed;
- one complete personalised recommendation rather than several competing
  weeks; and
- deterministic validation for permissions, coverage, constraints, portions,
  preparation, and approval.

## End-To-End Household Journey

### 1. Create the household

The first adult creates an account and household, names it, and adds the people
who regularly need to be considered. Other adults may be invited. Dependants
exist as household people without requiring accounts.

One adult may provide provisional information for everyone and create a first
plan before invited adults complete their own reviews. Account linking later
must preserve the existing person, profile, routine, and planning history.

### 2. Run private, repeatable adult reviews

An adult completes a private AI-led interview. The raw transcript and
intermediate conversation remain private to that participant. The session
progressively proposes household-visible person-profile facts for confirmation.

The interview is not one and done. An adult may start a new review whenever
tastes, routines, work patterns, or circumstances change.

The conversation should demonstrate synthesis as it proceeds. For example:

> You are in the office Tuesday through Thursday and do not want to prepare
> lunch in the morning. Should Monday and Wednesday dinner normally produce a
> portable leftover portion for the following day?

The agent should ask enough to create a useful first plan, expose uncertainty,
and leave lower-value detail for later refinement. It should not collect facts
without a defined planning use.

### 3. Build dependant profiles

An adult records information for dependants through a shorter guided flow. The
flow distinguishes:

- hard suitability and dietary constraints;
- simple ingredient, dish, and cuisine preferences;
- strong avoids versus ordinary dislikes;
- approved person-specific fallback repertoires;
- exact-product preferences and substitution policy;
- portion expectations by meal occasion; and
- school, childcare, packed-lunch, location, and activity routines.

The planner must not turn every exception into a second elaborate meal. It
should seek an approved packaged option, assembled meal, shared-component
variation, external meal, or other low-effort fallback.

### 4. Synthesize visible profiles

All adults can view confirmed profiles. In the MVP, any adult may edit any adult
or dependant profile. Every change is attributed and audited.

A profile may show, in ordinary product language:

- dietary pattern and hard constraints;
- loved dishes and cuisines;
- disliked or strongly avoided ingredients and meals;
- meal habits and intentional skips;
- approved fallbacks and exact-product rules;
- location and preparation context;
- default portion factors by occasion; and
- low-weight inferred preferences, clearly labelled.

Self-confirmed facts normally replace provisional facts. Hard safety or dietary
constraints are never silently removed.

### 5. Build routines conversationally

The agent proposes routines from interviews and asks the household to confirm or
adjust them. Users can describe repeated patterns naturally:

- the same breakfast every weekday;
- one of three approved breakfasts, pinned, preferred, or rotated;
- leftovers for office lunches Monday to Thursday;
- no leftover lunch on Friday because the person eats out;
- takeaway on Friday evening;
- a cooked family breakfast on Sunday;
- a packaged fallback for one person when the shared dinner is unsuitable;
- fasting until a configured occasion;
- a maximum number of substantial cook events; or
- a hands-off meal that somebody must start in the morning.

An agent-proposed routine offers **apply this period**, **save as recurring**, or
**reject**. A proposed fallback offers **use once**, **approve for future use**,
or **reject**. The agent never quietly creates enduring state.

The routine builder creates visible rules rather than hiding repeated
instructions in prompts. Adults can edit those rules visually or through
conversation.

### 6. Plan the week

At the start of planning, the agent asks only about exceptions to the established
baseline:

- unusual work, school, or travel days;
- visitors or absences;
- eating out;
- confirmed prepared food carried from the previous week;
- foods or recipes the household particularly wants;
- unusually busy evenings; and
- one-off changes to cooking capacity.

It then produces one complete recommended week with routines, shared meals,
personal alternatives, planned leftovers, packaged or external meals, flexible
slots, and skips already applied.

The household should not need to discover that someone does not eat fish and
manually repair the plan. Confirmed hard substitutions and approved fallbacks
must already be present.

### 7. Explain the recommendation

The weekly plan makes person-level effects visible without exposing private
transcript text.

A shared dinner may render as:

> **Wednesday dinner — Fish pie**  
> Louise and Child B: fish pie  
> Child A: chicken burger and seedless bun  
> Cillian: fish pie

Its rationale may explain:

- Child A fallback applied;
- approved dinner fallback;
- fish strongly avoided;
- uses the same oven window; and
- adds the exact burger and bun products to shopping.

A weekly summary may say:

> This plan applied 14 person routines, 3 fallback meals, 4 leftover
> allocations, 1 takeaway night, and stayed within your five-cook-event target.

Rationale should help adults trust the plan and spot incorrect assumptions.

### 8. Revise through conversation and UI

Adults can say:

- make Tuesday easier;
- cook enough on Monday for two lunches;
- replace fish this week;
- use pizza instead of the usual fallback;
- repeat the same breakfast all week;
- move the roast to Saturday; or
- remove one cook event without leaving uncovered meals.

While the plan is a draft, the system repairs affected portions, leftovers,
prepared components, person alternatives, cook events, and shopping preview. It
shows consequential changes.

After approval, the same request creates a proposed revision with a visible
diff. It never silently rewrites the active week.

### 9. Approve and shop

Any adult may edit, approve, reject, reopen, or revise the plan in the MVP. All
actions are audited.

The draft includes a shopping preview. Approval creates the active
retailer-neutral shopping list. External meals, flexible slots, and intentional
skips add no shopping demand. Planned leftovers contribute through the original
cook event only.

### 10. Live the week without tracking chores

No one is required to mark meals cooked or eaten. The system assumes the
approved plan happened unless an adult reports an exception.

Planned same-week leftovers need no separate confirmation. Incidental leftovers
can be added through a quick approximate-quantity and fridge-or-freezer action.
Ad hoc updates are available but never required.

### 11. Optionally review the week

Before the next plan, the agent may ask:

> Before we plan next week, how did this week go?

The review is optional and never blocks planning. Lightweight signals include:

- liked or disliked;
- skipped or not made;
- too much effort;
- wrong quantity;
- fallback worked or failed;
- dependant would not eat it; or
- make again.

The review also confirms any expected cross-week fridge or freezer portions
before the next plan relies on them. The agent asks a focused follow-up only
when it would materially improve future planning.

## Conversation Design Requirements

### Progressive artifact creation

The conversation creates and updates visible artifacts throughout:

- person profile cards;
- a household summary;
- routine rules;
- proposed fallbacks;
- conflicts or uncertainty requiring a decision;
- cooking capacity and preparation windows;
- the proposed week;
- cook, prepared-component, and leftover allocations;
- planning rationale; and
- a change summary before approval.

A user should never need to trust that the transcript alone contains the truth.

### Demonstrate understanding

The agent connects facts across people and time. It should notice, for example,
that a late workday, a strong avoid, a slow cooker, and a leftover preference
jointly suggest a larger hands-off cook on the preceding morning.

### Ask fewer, better questions

Questions are chosen for expected planning value. The agent avoids exhaustive
interrogation, repeated questions, and collection without a product use.

### Make assumptions explicit

High-impact constraints and enduring routines require confirmation. Soft
inferred preferences remain visible and low-weight. New routines and fallbacks
always offer a clear accept-once, save, or reject transition.

### Stay nutrition-aware without becoming clinical

The agent may provide transparent qualitative observations, such as a repetitive
or unusually high-effort week. It does not implement calorie, macro, weight,
muscle, medical, or therapeutic-goal optimization in the MVP.

## Routine Builder Requirements

A routine is a reusable, versioned planning rule rather than copied calendar
cells. It may define:

- applicable days and meal occasions;
- location or context;
- an exact food or small approved set;
- pin, prefer, or rotate behaviour;
- a meal option, leftover policy, external meal, flexible pattern, or skip;
- people covered;
- portion expectations;
- a fallback rule;
- equipment and preparation window;
- cooking-capacity effect;
- priority and conflict behaviour; and
- effective dates and one-off exceptions.

Routine evaluation produces concrete plan input for one period. One-off
exceptions override the baseline without silently rewriting the enduring rule.

## Compressed Visual Model

Internally, the plan accounts for every managed `person × date × meal occasion`
requirement. The default UI should compress that model by:

- grouping shared meals;
- collapsing repeated routines;
- nesting person exceptions;
- linking leftovers and prepared components to cook events;
- showing applied rationale; and
- highlighting only unresolved or conflicting coverage.

The internal domain union is not automatically the frontend contract. Build the
projection that best communicates the household week.

## Privacy Experience

- Raw adult interview transcripts are private to the participant.
- Confirmed person-profile facts are household-visible by default.
- Any adult may edit profiles and shared plans in the MVP; changes are audited.
- Shared routines, plans, approvals, shopping lists, and weekly reviews are
  visible to authorized adults.
- Proposed, inferred, provisional, and confirmed facts remain distinguishable.
- Planning rationale references confirmed product facts and does not quote the
  private transcript.

## Experience Evaluation

Evaluate the AI experience with representative household scenarios, not only
schema and prompt tests. Measure:

- important facts discovered;
- unnecessary questions asked;
- correctness of synthesized profiles and routines;
- assumptions accepted or corrected;
- hard constraints respected;
- quality and practicality of the first recommended week;
- correctness and clarity of fallbacks and rationale;
- repair quality after a requested change;
- user-rated sense of being understood; and
- time to reach approval.

A long or fluent conversation that does not improve planning accuracy is not a
successful interaction.