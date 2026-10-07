# PDR-0007 — Decide who can see each conversation

- Status: Accepted
- Date: 2026-08-25
- Owners: Household product

## Decision and reason

Adults need continuing planning conversations without exposing private dialogue
or treating the entire archive as current truth.

A household has one shared planning chat for authorized adults, covering plans,
routines, explanations, revisions, review and shopping. Its messages, tool actions
and mutations are visible and auditable to them. It may query household-visible
confirmed profiles, routines, fallbacks, recipes, plans, prepared stock, feedback
and shopping through admitted operations.

An adult may also have private threads for personal questions and profile review.
They may use shared confirmed state and that adult's own history, never another
adult's private chat or interview. Confirmed changes still enter the household
through authorized typed commands with the normal shared visibility. Dependants
have no direct chat access; adults may manage their needs in either conversation.

Private interviews retain the PDR-0001 lifecycle. Completion closes mutations
and retains participant-only read-only history. Later review starts a new
conversation; completing one never shares its transcript.

Retain history durably, but retrieve only relevant context. Shared turns begin
with current confirmed household and active-plan state, bounded shared memory or
summary, and relevant prior context. Private turns may additionally retrieve
that adult's private history. Private transcripts never become implicit shared
memory. Derived planning memory remains attributable, inspectable and subordinate
to confirmed state.

Conversation history, summaries, thread/model metadata, streaming and unfinished
work belong to the conversation capability. Canonical people, profiles, routines,
fallbacks, recipes, plans, stock, approvals, feedback and shopping remain household product
state. The agent proposes and orchestrates; validated authorized commands commit.
Record whether a change came from shared/private chat, interview or manual action
without exposing private text. Shared synchronization cannot broadcast private
messages. Conversation deletion/export/support access are separate from deletion
of confirmed household state.

Dependant accounts, hidden confirmed profile facts, adult direct messaging,
public/cross-household chats, MCP thread access, transcript export/portability and
unbounded semantic history retrieval remain deferred pending concrete need and
privacy policy.
