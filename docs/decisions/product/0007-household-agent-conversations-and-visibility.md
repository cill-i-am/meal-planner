# PDR-0007 — Household Agent Conversations And Visibility

- Status: Accepted
- Date: 2026-08-25
- Owners: Household product

## Context

Meal Planner needs a durable conversational surface beyond the initial profile
interview. Adults should be able to return later and ask the agent to review a
profile, build routines, explain a plan, revise the active week, or discuss a
household planning problem without losing prior context.

The household also has two different privacy needs:

- shared planning work should be visible to all adults; and
- a candid adult interview or personal conversation must not become visible to
  another household adult merely because both belong to the same household.

Durable history is useful, but durable storage does not mean every historical
message should be injected into every future model call. Confirmed structured
household state remains the reliable planning context.

## Decision

### Shared household planning chat

- Each household has one shared planning-chat surface visible to all authorized
  adults.
- The shared chat is used for household work such as building the weekly plan,
  asking why routines or fallbacks were applied, moving meals, changing cook
  events, approving a repair, reviewing the week, or discussing shared shopping
  demand.
- The shared chat may read household-visible confirmed profiles, routines,
  fallbacks, recipes, plan state, prepared stock, feedback, and shopping state
  through admitted queries.
- Messages, tool actions, and resulting product mutations in the shared chat are
  visible and auditable to household adults.

### Private adult chats

- Each authenticated adult may have private chat threads visible only to that
  adult.
- Private chats support candid questions, ad hoc profile reviews, personal
  preference changes, and other conversations the adult does not want exposed as
  raw dialogue.
- A private chat may read the household-visible confirmed state plus that
  adult's own private thread history.
- It must not read or reveal another adult's private chat or interview
  transcript.
- Confirmed profile, routine, fallback, plan, or other product changes proposed
  from a private chat still enter the household authority through typed commands
  and become visible according to the accepted household product rules.

### Private interviews

- A private interview is a specialized private adult conversation with the
  lifecycle accepted in PDR-0001.
- It remains private to the participating adult, progressively proposes visible
  structured artifacts, and becomes retained read-only history when completed.
- Completing an interview does not make its transcript available to the shared
  chat or another adult.
- A later review starts a new private conversation rather than appending to the
  completed interview.

### Dependants

- Dependants have no direct chat access in the MVP.
- Adults may discuss and manage dependant profiles, routines, fallbacks, and
  feedback through shared or private adult conversations, subject to normal
  household authority and audit.

### Conversation memory

- Conversation history is retained durably for continuity.
- The agent does not inject the household's complete historical archive into
  every model turn.
- Ordinary shared planning turns begin from current confirmed household state,
  relevant active-plan state, a small shared conversational memory or summary,
  and only the prior thread context needed for the request.
- Private turns may additionally use relevant history from that same adult's
  private threads.
- Raw private transcripts are never used as implicit shared household memory.
- Any derived memory that can affect planning must remain attributable,
  inspectable, and subordinate to confirmed product state.

### Product authority

- Conversation history, summaries, thread metadata, model provenance, streaming
  state, and unfinished conversational work belong to the agent-conversation
  capability.
- Confirmed people, profiles, routines, fallbacks, recipes, plans, prepared
  stock, approvals, feedback, and shopping lists remain canonical in the
  household product authority.
- The agent may propose and orchestrate; product truth changes only through
  typed, validated, authorized commands.

## Consequences

- Shared and private conversations cannot be represented as one undifferentiated
  household transcript.
- The product needs explicit thread visibility, participant, lifecycle, and
  authorization metadata.
- Shared-chat synchronization must never fan out private adult messages.
- The model context builder needs selective retrieval and summaries rather than
  unbounded transcript concatenation.
- Product projections must show whether a change came from shared chat, private
  chat, interview, manual UI, or another admitted source without exposing
  private message text.
- Conversation deletion, export, and support-access policies remain separate
  from deletion of confirmed household product state.

## Deferred

- dependant chat accounts;
- private facts hidden from other household adults;
- direct messaging between household adults;
- public or cross-household agent conversations;
- MCP exposure of chat threads;
- long-term transcript export and portability; and
- automatic semantic retrieval over every historical transcript before a
  concrete product need and privacy policy exist.