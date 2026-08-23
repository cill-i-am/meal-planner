# Experience Blueprint

## Experience Thesis

Meal Planner should feel like a thoughtful household planning session that
happens to produce structured product state. The agent is not a decorative chat
box and the UI is not a questionnaire disguised as a conversation.

The best experience combines:

- a natural, high-quality conversation for discovery and revision;
- visible editable artifacts for trust and speed; and
- deterministic validation for coverage, constraints, portions, and approval.

## End-To-End Household Journey

### 1. Create the household

The first adult creates an account and household, names it, and adds the people
who regularly need to be considered. Other adults may be invited. Dependants
exist as household people without requiring accounts.

The product should distinguish the authenticated member from the person who
eats. One user may manage their own person profile and one or more dependant
profiles.

### 2. Run private adult discovery sessions

Each adult completes a private interview. The raw transcript and intermediate
conversation remain private to that participant. The session progressively
proposes household-visible person-profile facts for confirmation.

The conversation should demonstrate synthesis as it proceeds. For example:

> You are in the office Tuesday through Thursday and prefer not to prepare
> lunch in the morning. Should Monday and Wednesday dinner normally produce a
> portable leftover portion for the following day?

The agent should not ask every possible question. It should ask enough to build
an accurate first plan, identify uncertainty, and leave lower-value details for
later refinement.

### 3. Build dependant profiles

An adult records information for dependants through a shorter guided flow. The
flow should distinguish:

- hard safety or dietary constraints;
- accepted foods and reliable fallback meals;
- ordinary dislikes that can be challenged gently over time;
- portion and life-stage considerations; and
- school, childcare, packed-lunch, and activity routines.

The planner must not turn every exception into a second elaborate meal. It
should seek low-effort variations, shared components, or a small repertoire of
accepted fallback meals.

### 4. Synthesize visible profiles

The household can view the confirmed profile for each person. A profile may
show, in ordinary product language:

- dietary pattern and hard constraints;
- loved dishes and cuisines;
- disliked ingredients, textures, or heat levels;
- meal habits and intentional skips;
- preferred fallback meals;
- cooking or portion considerations; and
- current planning goals.

Adults edit their own profiles by default. Household adults may manage dependant
profiles. The exact permission model remains an explicit product decision.

### 5. Build routines conversationally

The agent proposes routines from the interviews and asks the household to
confirm or adjust them. The user can describe repeated patterns naturally:

- the same breakfast every weekday;
- leftovers for office lunches Monday to Thursday;
- no leftover lunch on Friday because the person eats out;
- takeaway on Friday evening;
- a cooked family breakfast on Sunday;
- a child fallback whenever a shared tomato-based pasta is unsuitable; or
- fasting until a configured meal occasion.

The routine builder creates visible rules rather than hiding repeated
instructions in prompts. Users can edit those rules in a visual routine editor
or through conversation.

### 6. Plan the week

At the start of a planning session, the agent asks only about exceptions to the
established baseline:

- unusual work or school days;
- visitors or absences;
- eating out;
- food that should be used;
- desired variety or recurring favourites;
- unusually busy evenings; and
- one-off goals or constraints.

It then proposes a complete week using routines, shared meals, individual
exceptions, intentional leftovers, eating out, and skips.

### 7. Review through conversation and UI

The household sees a compressed weekly plan rather than a raw coverage matrix.
Shared meals are shown once with the people covered. Exceptions appear only
where relevant. Cook events make batch and leftover intent visible.

Users should be able to say:

- make Tuesday easier;
- cook enough on Monday for two lunches;
- replace the fish meal for one person only;
- repeat the same breakfast all week;
- use the imported curry this weekend; or
- remove one cooking event without leaving uncovered meals.

Every conversational change maps to a typed domain command and returns a visible
revision. The agent explains meaningful trade-offs and cannot bypass hard
constraints.

### 8. Approve and shop

A plan remains a draft until explicitly approved. Approval requires complete
coverage for the beta unless a later policy deliberately introduces accepted
incomplete plans.

The approved plan produces a consolidated retailer-neutral shopping list. It
does not authenticate with a retailer or mutate an external basket.

### 9. Review the week

The main feedback loop occurs before generating the next plan:

> Before we plan next week, how did this week go?

Each planned meal or routine can be marked with lightweight signals such as:

- liked;
- disliked;
- skipped;
- not made;
- too much effort;
- wrong quantity;
- child would not eat it; or
- make again.

The agent asks one focused follow-up only when it would materially improve the
profile, routine, recipe, or planning policy. Meal-by-meal feedback remains
available but optional.

## Conversation Design Requirements

### Progressive artifact creation

The conversation should create and update visible artifacts throughout:

- person profile cards;
- a household summary;
- routine rules;
- conflicts or uncertainty requiring a decision;
- fallback-meal options;
- the proposed week;
- cook and leftover allocations; and
- a change summary before approval.

A user should never need to trust that the transcript alone contains the truth.

### Demonstrate understanding

The agent should connect facts across people and time. It should notice, for
example, that a late workday, a dislike, and a leftover preference jointly
suggest a larger cook event on the preceding evening.

### Ask fewer, better questions

Questions should be chosen for expected planning value. The agent should avoid
exhaustive interrogation, repeated questions, and collecting information that
has no defined product use.

### Make assumptions explicit

A proposed assumption must be inspectable and correctable. High-impact or hard
constraints require confirmation. Lower-impact defaults may be proposed with a
clear opportunity to change them.

### Stay nutrition-aware without becoming clinical

The agent may discuss balanced variety, protein preferences, energy-related
meal habits, or user-stated goals. It must not diagnose, prescribe treatment, or
present uncertain nutritional claims as facts. Sensitive health-related inputs
need an explicit purpose and careful handling.

## Routine Builder Requirements

A routine is a reusable, versioned planning rule rather than a copied set of
calendar cells. It may apply to one person or the household and may define:

- applicable days and meal occasions;
- location or context, such as home, office, school, or activity;
- a fixed food, recipe, routine category, or leftover policy;
- people covered;
- portion expectations;
- a fallback rule;
- priority and conflict behavior; and
- effective dates and one-off exceptions.

Routine evaluation should produce meal requirements and suggested coverage for
a concrete planning period. One-off weekly exceptions override the baseline
without silently rewriting the enduring routine.

## Compressed Visual Model

Internally, the plan accounts for every required `person × date × meal
occasion` cell. The UI should compress that model by:

- grouping shared meals;
- collapsing repeated routines;
- showing exceptions rather than duplicating ordinary coverage;
- linking leftovers back to their cook event; and
- highlighting only unresolved or conflicting cells.

An expert user may open the complete matrix for diagnosis, but the default
experience should feel like a household week, not a spreadsheet.

## Privacy Experience

- Raw adult interview transcripts are private to the participant.
- Confirmed person-profile facts are household-visible by default.
- Shared routines, plans, approvals, shopping lists, and weekly reviews are
  visible to authorized household members.
- The product should clearly distinguish a proposed fact from a confirmed fact
  and show who may edit it.
- The system cannot promise that a shared plan reveals nothing about visible
  preferences; it should promise appropriate handling of the private transcript
  and accurate attribution of confirmed state.

## Experience Evaluation

The AI experience should be evaluated with representative household scenarios,
not only schema and prompt tests. Evaluation should measure:

- important facts discovered;
- unnecessary questions asked;
- correctness of synthesized profiles and routines;
- assumptions accepted or corrected;
- hard constraints respected;
- quality and practicality of the first proposed week;
- user-rated sense of being understood; and
- time to reach approval.

A long or fluent conversation that does not improve planning accuracy is not a
successful interaction.