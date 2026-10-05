# Agent conversations

The conversation Agent stores messages, proposed blocks, turn status, and action receipts. Saved family, person, profile, planning content, and meal-plan state stays with the services that already own it. A model reply can propose a change; an adult reviews the displayed block before the API host sends a canonical command. In private family setup, an explicit conversational confirmation can accept that displayed roster through the same action endpoint.

## Scopes and entry points

| Scope | Address | Admission | Visibility |
| --- | --- | --- | --- |
| `AccountPrivateSetup` | `/v1/agent-conversations/setup` | Signed-in account | One immutable account-owned conversation for family setup. |
| `FamilyShared` | `/v1/families/:familyId/agent-conversation` | Current Better Auth membership and a linked, active adult person in that family | One immutable conversation shared by admitted adults in that family. |

Each scope has an action endpoint under the same address and a `/chat` endpoint for a TanStack AI event stream. The browser reads the conversation and submits reviewed actions through the [shared Effect HTTP contract](../../packages/agent-conversations-api/src/index.ts). The chat bridge accepts the TanStack request shape, checks its thread and turn identity, and forwards a closed input to the Agent. The host derives the scope and account key from the authenticated request. The browser cannot choose an Agent object name or supply canonical context.

Shared conversation screens read the family feature's roster query. People changes invalidate that query, so the conversation uses current names and membership. If the roster read fails, the conversation stays unavailable until a roster read succeeds. A person-specific fact cannot be reviewed when its person is absent from the loaded roster.

The host uses the existing [application access boundary](../../apps/api/src/features/auth/application-access.ts) for session, same-origin, and rate-limit checks. Family admission also verifies live membership and the current linked adult person before reads, turns, and actions. Conversation responses use `Cache-Control: no-store`.

## Context and privacy

Private family setup receives the signed-in account's display name from the
authenticated API host. The assistant uses it for the creator and asks only for
missing people's names or roles. An omitted family name becomes a visible label
from the creator's given name, which the person can correct before saving.
This setup field is null for shared family conversations;
account email, session identifiers and credentials are not model context.

For a shared turn, the [API host](../../apps/api/src/agent-conversations.ts) reads the family through `FamilyService` and obtains the current people, confirmed profile facts, planning content, and an explicitly selected meal plan through admitted household operations. The selected `planId` and `focusPersonId` locate existing records; they do not carry authority or saved content. A focused person must be active, and an adult may focus on themselves or a dependant. The host leaves out profile audit history and provisional facts. Private interview transcripts never enter shared conversation context.

The Agent retains the full admitted snapshot. The model receives bounded recent messages and a smaller projection of the selected plan, including grouped current choices. Its output is decoded as a closed `submitConversationTurn` result. For a complete draft, the model can propose grouped schedule rows. Rows identify exact person-and-occasion pairs with a quantity for each person; a later row may refer to a planned cook output by row key and day offset. The Agent expands the rows against the saved requirement matrix, allocates cook and output IDs, and saves one full plan proposal. It rejects overlapping rows, missing references, and over-allocation. The Agent also checks other references and versions, assigns block IDs, and saves proposals. The model cannot execute a family, profile, content, or plan mutation. Missing or invalid provider configuration produces the typed `not_configured` turn failure; provider, output, and context-limit failures remain visible on the saved turn.

## Reviewed actions and recovery

`beginAction` saves the exact decision and allocates stable command IDs before any canonical write. Repeating the same action ID and payload returns the saved reservation. A changed payload with that ID conflicts. The browser retains an action whose result is unknown and retries it with the same ID.

Family setup renders assistant replies as plain messages and roster proposals as
the persistent family table. Routine questions do not need generated UI blocks.
The browser retains the exact submitted action in account-scoped session storage
until a conversation read contains its terminal receipt. Reloading an unresolved
save never replays it automatically; the adult can say **try again** or use
**Check save** to retry that request. A committed setup action completes family
setup and opens food discovery. Manual setup is an explicit alternative.

For setup confirmation, the chat request names the roster block ID and revision currently on screen. The model returns a typed confirmation intent. The Agent accepts it only for the latest previously saved, still proposed private roster, and only when the turn contains no roster edits. It saves the exact roster reference and a stable action ID on the completed turn. The browser then submits that ID and the exact displayed roster through the existing setup action endpoint. The Agent rejects stale roster actions and requires actions using the confirmation ID to carry the exact roster fields. A corrected roster replaces the previous proposal; unchanged people keep their draft IDs. The assistant asks whether the displayed people look right in its reply text and can suggest a visible family label from the creator's given name when no family name was supplied.

| Accepted block | Canonical command |
| --- | --- |
| Roster | `FamilyService.create` saves the reviewed family name and links the reviewed creator name; the household people gateway creates each additional reviewed person. |
| Person fact | The household profile command adds, confirms, replaces, or removes a fact for the acting adult or a dependant. Reducing a saved safety constraint requires a separate, explicit confirmation. Another adult's profile cannot be changed through the shared assistant. |
| Planning setup | One reviewed command sets managed occasions, availability, or cooking capacity, or saves a meal option or fallback. The Agent assigns new record IDs before review. Suitability and prepared-food carry-over confirmations are outside this proposal set. |
| Routine | A versioned `PutRoutine` command changes planning content. |
| Plan change | A versioned `ChangeMealPlanPayload` changes the named plan, including a complete reviewed draft matrix where proposed. |

The host marks each completed step in the Agent. If a response is lost after a canonical write, it repeats the same command ID so the canonical receipt can return the original result. The host does not reject a retry merely because the saved version has advanced. Known conflicts or denied actions become terminal rejected receipts; uncertain dependency outcomes stay unknown until reconciled. Dismissal changes only the proposal state.

## Runtime and evidence

[Binding composition](../../apps/api/src/features/agent-conversations/conversation-binding.ts) uses a SQLite-backed `AgentConversation` Durable Object and a [stage-owned AI provider](../../apps/api/src/infrastructure/agent-provider.ts). The provider binds an authenticated Gateway ID, account ID, and scoped token to the Worker. Gateway authentication is required for Unified Billing. Deployed turns use GPT-6 Luna through Cloudflare Responses. The model request disables gateway logging, caching, SDK retries, and provider response storage. Missing or invalid config does not call a provider. The native browser fixture supplies a separate, bounded synthetic provider response to exercise the protocol and canonical writes. It also seeds one recipe through the real provider-free import lifecycle for cooking UI checks. These tests do not measure live model quality. Record native HTTP and Agent storage checks separately from browser checks and live-provider results. Deployment and provider activation require their own evidence.

The [Agent implementation](../../apps/api/src/features/agent-conversations/conversation-session.ts) owns conversation persistence and replay. The [family reference](family-api.md) and [household data reference](household.md) own the canonical records and permissions.

## Local live preview

The opt-in [local preview API entry](../../apps/api/src/local/preview-api.ts) exports the production `AgentConversation` and mounts the same authenticated family, conversation, household, planning-content, and plan handlers as the native test host. Its selected model uses the local runner's real Workers AI REST configuration. The entry accepts only its configured loopback origin and exposes a small unauthenticated readiness route. It has no test-control, seed, or captured-mail read routes. Reset and invitation messages stay in a local mail capture binding; they are not sent externally.

The preview mounts the canonical recipe-detail GET contract without import writes because the import Workflow is not configured locally. Linked-account departure requests receive a typed Workflow-unavailable result. Private discovery has no live provider in this preview and reports its missing configuration. Local preview observations are separate from deterministic browser tests and from deployed provider evidence.

The selected preview model is `openai/gpt-6-luna`, called through Cloudflare's
Responses endpoint and billed from prepaid AI Gateway credits. It uses the
same AI-only Cloudflare OAuth profile. The model proposes one closed tool result;
the existing Agent guards validate it before any proposal is accepted. Account
setup exposes only questions and roster proposals in its tool schema. See the
[local runtime guide](../how-to/local-development.md#live-family-and-planning-agent)
for startup, billing requirements and future Alchemy ownership.

To check the local host's family and household bindings without calling a model,
build the web Worker, then run this from the repository root:

```sh
node --import tsx apps/api/src/test/local-preview-family.test-fixture.ts
```

The check uses port 4498 and a disposable directory. It signs up a synthetic
account, creates and replays a family and person, and verifies the linked creator.

## Native development after the main merge

The native Alchemy stack uses local state during development. It does not
provision the deployed agent gateway or account token. Optional `LOCAL_AGENT_*`
settings supply an existing account, gateway, redacted token and the conversation
and private-discovery provider configurations. Missing settings produce the
existing `not_configured` turn failure while auth and household storage remain
available. See [local development](../how-to/local-development.md).

The Worker entry module exports the Agents SDK class separately from the
Node-loadable infrastructure declaration. The pinned Alchemy build patch keeps
that native export alongside its generated Effect Durable Object and migration
bridges; the actual bundle test verifies the resulting exports.
