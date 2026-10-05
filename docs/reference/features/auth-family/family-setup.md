# Family setup

## Sub-features

- Describe a family to receive an editable proposal, or set it up without chat.
- Confirm the reviewed roster to create a real family; choose an already joined family.
- Review the saved roster and open person management.
- Recover interrupted creation without making another family.
- Confirm setup and enter the next application stage.

## How to get to it (user POV)

Enter `/setup` while signed in. Without a family it opens `/setup/family`.
An incomplete selected family opens `/setup/review`; a completed one enters `/`.
The `familyId` search parameter identifies the chosen family on setup routes.

**Who’s at your table?** accepts a natural-language description. The account
name already occupies the first place. A typed proposal fills the other places
around the same table, with each person's name and Adult or Child role. Chat
stays plain text. Describe corrections to update the displayed draft; an omitted
family name uses a visible label from the creator's given name.

Explicit agreement in chat accepts the exact displayed block and revision. The
server binds that agreement to a stable action ID; the browser submits the exact
roster through the canonical action endpoint. A committed receipt completes setup
and automatically opens food discovery at `/?area=tastes`. No additional approval
button appears. A lost result retains the request across reload; say **try again**
or use **Check save** to retry that same action. Reload never retries it silently.

**Add manually instead** opens the roster editor with the displayed draft.
**Return to conversation** preserves the chat, unsent message and manual edits
while switching modes; manual edits remain unsaved until its create action. Manual
creation uses existing family and person commands, retaining submitted request
IDs while mounted. If a later person is uncertain, the screen shows the confirmed
count and can check the remaining request or open the saved family. Chat failure
does not disable manual setup.

Manual creation and selecting an existing family open **Your family** at
`/setup/review?familyId=…`. **Add someone else** opens `/setup/people`.
**Continue** opens `/setup/ready`, headed **Your family is ready.** Both
**Tell us how you eat** and **I’ll do this later** complete setup before leaving.
Stop verification at the destination boundary (`/?area=tastes` or `/`); the
food features are outside this map.

If the setup route cannot load its family data, **Your family couldn’t be
loaded** offers both **Try again** and **Log out and sign in again**. The latter
clears account-scoped cached data and returns to login with the setup URL as its
redirect, so a successful sign-in can resume the same route.

## Driving it with agent-browser

Use a disposable signed-in organizer and [the shared setup](README.md).
For your own chat messages, use the [live local preview](../../../how-to/local-development.md#live-family-and-planning-agent).
The native test fixture supplies scripted responses and does not evaluate live
family extraction.

| Path | Drive | Proof |
| --- | --- | --- |
| Assistant draft | Describe a family; correct a name or role in chat; explicitly agree with the table | The exact displayed roster saves once, setup completes, and food discovery opens automatically |
| Manual create | Select **Add manually instead**, enter a family name and people, then **Create our family** | Review shows the creator once and each confirmed person; saved family has `in_progress` setup |
| Persistence | Reload review and open it in a second authenticated tab | Same family ID, saved name, and roster; no second create request |
| Choose existing | Open family setup and select a listed family | URL and roster identify that family; no new family is created |
| Review → confirm | Select **Continue** | Confirmation opens; no `complete-setup` write occurred |
| Finish | Select either final action in separate runs | Completion succeeds before leaving; later GET shows `complete` with completion time |
| Incomplete creator | With an interrupted native create fixture, open review and select **Finish creating family** | Same family gains its creator person once via `resume-creation` |
| Unknown creation result | Lose a chat save response; say **try again** or use **Check save**, including after reload | The same action or person mutation ID and reviewed payload are retried; one effective family and roster result |
| Partial person save | Interrupt a later manual person command after the family and earlier people save | Confirmed people remain saved; the screen shows the count and retries only the uncertain command |
| Chat unavailable | Fail the conversation read, then select **Add manually instead** | Manual family creation remains available |
| Unsent form | Type a name, then log out before submitting | No family write and no persisted form draft |
| Reload after an unknown result | Reload after the write response is lost | Chat restores the exact unresolved action for explicit retry; manual setup reads saved resources without replaying its in-memory mutation |
| Permission failure | Open another family's URL with an unrelated account | No protected roster or authorized write; an explicit failure is shown |

For response loss, use an owned network fault fixture that can distinguish a
request rejected before execution from a committed write whose response was lost.
Merely turning the browser offline proves only the failure it actually induces.

## Gotchas

Rendering **Your family is ready.** does not itself complete setup. The final
button does. Members **Continue** is navigation only. Completion does not freeze
the resource or roster.

Manual requests and unsent forms live in memory. Chat retains its exact submitted
action in account-scoped session storage until a read includes its terminal receipt.
Reloaded unknown actions require an explicit retry. A read must not create the missing creator;
recovery is an explicit action. Members who cannot manage an incomplete family
need the organizer to finish setup.

The pre-save family name is editable. There is no dedicated saved-family rename
screen here; rename is an API capability. Invitations are optional and happen
from the saved roster, so an accepted draft does not send one.
See [the canonical family contract](../../family-api.md) and
[screen ownership](../../../../apps/web/src/features/onboarding/AGENTS.md).
Source checks: [roster editor tests](../../../../apps/web/src/features/onboarding/family-proposal-review.test.tsx),
[setup routing tests](../../../../apps/web/src/features/onboarding/setup-state.test.ts),
and the native tests alongside [family adapters](../../../../apps/api/src/features/families/AGENTS.md).
