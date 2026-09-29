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

**Who’s at your table?** accepts a natural-language description. The assistant
already receives the signed-in account name and asks only for missing setup
details. The user can correct that name in chat or in the roster review. The
assistant may ask a clarifying question before showing a draft. The draft keeps the family
name, the organiser’s name, and each person’s Adult or Child role editable. The
user selects **Create our family** to accept that exact roster. The server saves
the family and people through their canonical operations and returns its action
state. A lost or partial result keeps the same reviewed action for **Check and
continue**; it does not submit another roster.

**Set up without chat** opens the same editor with an empty family and people
draft. It uses the existing family and person commands, retaining each submitted
request ID while this screen stays mounted. If the family is saved but a later
person is uncertain, the screen shows the confirmed count and lets the user
check the same remaining request or open the saved family. Chat availability does
not block setup. Existing families appear as named buttons. Successful creation
opens **Your family** at `/setup/review?familyId=…`. **Add someone else** opens
`/setup/people`.
**Continue** opens `/setup/ready`, headed **Your family is ready.**
Both **Tell us how you eat** and **I’ll do this later** complete setup before
leaving. Stop verification at the destination boundary (`/?area=tastes`
or `/`); the destination features are outside this map.

## Driving it with agent-browser

Use a disposable signed-in organizer and [the shared setup](README.md).
For your own chat messages, use the [live local preview](../../../how-to/local-development.md#live-family-and-planning-agent).
The native test fixture supplies scripted responses and does not evaluate live
family extraction.

| Path | Drive | Proof |
| --- | --- | --- |
| Assistant draft | Describe a family and answer any clarification; edit a proposed name or role; select **Create our family** | The accepted roster, not the unreviewed text, becomes the saved family and people |
| Manual create | Select **Set up without chat**, enter a family name and people, then **Create our family** | Review shows the creator once and each confirmed person; saved family has `in_progress` setup |
| Persistence | Reload review and open it in a second authenticated tab | Same family ID, saved name, and roster; no second create request |
| Choose existing | Open family setup and select a listed family | URL and roster identify that family; no new family is created |
| Review → confirm | Select **Continue** | Confirmation opens; no `complete-setup` write occurred |
| Finish | Select either final action in separate runs | Completion succeeds before leaving; later GET shows `complete` with completion time |
| Incomplete creator | With an interrupted native create fixture, open review and select **Finish creating family** | Same family gains its creator person once via `resume-creation` |
| Unknown creation result | Lose a response after submission; select **Check and continue** while the screen stays mounted | The same action or person mutation ID and reviewed payload are retried; one effective family and roster result |
| Partial person save | Interrupt a later manual person command after the family and earlier people save | Confirmed people remain saved; the screen shows the count and retries only the uncertain command |
| Chat unavailable | Fail the conversation read, then select **Set up without chat** | Manual family creation remains available |
| Unsent form | Type a name, then log out before submitting | No family write and no persisted form draft |
| Reload after an unknown result | Reload after the write response is lost | Reads saved families; does not restore or automatically replay the submitted mutation |
| Permission failure | Open another family's URL with an unrelated account | No protected roster or authorized write; an explicit failure is shown |

For response loss, use an owned network fault fixture that can distinguish a
request rejected before execution from a committed write whose response was lost.
Merely turning the browser offline proves only the failure it actually induces.

## Gotchas

Rendering **Your family is ready.** does not itself complete setup. The final
button does. Members **Continue** is navigation only. Completion does not freeze
the resource or roster.

Pending submitted requests and unsent forms live only in memory. Reloading
reads saved resources and restores neither local state. A read must not create the missing creator;
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
