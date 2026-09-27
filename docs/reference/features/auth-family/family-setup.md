# Family setup

## Sub-features

- Name and create a real family; choose an already joined family.
- Review the saved roster and open person management.
- Recover interrupted creation without making another family.
- Confirm setup and enter the next application stage.

## How to get to it (user POV)

Enter `/setup` while signed in. Without a family it opens `/setup/family`.
An incomplete selected family opens `/setup/review`; a completed one enters `/`.
The `familyId` search parameter identifies the chosen family on setup routes.

**Name your family** contains **Family name** and **Create family**. Existing
families appear as named buttons. Successful creation opens **Your family** at
`/setup/review?familyId=…`. **Add someone else** opens `/setup/people`.
**Continue** opens `/setup/ready`, headed **Your family is ready.**
Both **Tell us how you eat** and **I’ll do this later** complete setup before
leaving. Stop verification at the destination boundary (`/#private-interviews`
or `/`); the destination features are outside this map.

## Driving it with agent-browser

Use a disposable signed-in organizer and [the shared setup](README.md).

| Path | Drive | Proof |
| --- | --- | --- |
| Create | Enter a family name and select **Create family** | Review shows the creator once; request returns a saved family with `in_progress` setup |
| Persistence | Reload review and open it in a second authenticated tab | Same family ID, saved name, and roster; no second create request |
| Choose existing | Open Name and select a listed family | URL and roster identify that family; no new family is created |
| Review → confirm | Select **Continue** | Confirmation opens; no `complete-setup` write occurred |
| Finish | Select either final action in separate runs | Completion succeeds before leaving; later GET shows `complete` with completion time |
| Incomplete creator | With an interrupted native create fixture, open review and select **Finish creating family** | Same family gains its creator person once via `resume-creation` |
| Unknown creation result | Lose a response after submission, then reload | **Let’s check your family** / **Check and continue** resumes the original name and mutation ID |
| Unsent form | Type a name, then log out before submitting | No family write and no persisted form draft |
| Storage unavailable | Block retained-command storage in an isolated test | Visible error and no create request dispatched |
| Permission failure | Open another family's URL with an unrelated account | No protected roster or authorized write; an explicit failure is shown |

For response loss, use an owned network fault fixture that can distinguish a
request rejected before execution from a committed write whose response was lost.
Merely turning the browser offline proves only the failure it actually induces.

## Gotchas

Rendering **Your family is ready.** does not itself complete setup. The final
button does. Members **Continue** is navigation only. Completion does not freeze
the resource or roster.

The browser retains submitted unknown requests, not screen position. Reloading
an unsent form need not restore it. A read must not create the missing creator;
recovery is an explicit action. Members who cannot manage an incomplete family
need the organizer to finish setup.

There is no dedicated family-name edit screen here; rename is an API capability.
See [the canonical family contract](../../family-api.md) and
[screen ownership](../../../../apps/web/src/features/onboarding/AGENTS.md).
Source checks: [family name tests](../../../../apps/web/src/features/onboarding/family-name.test.tsx),
[setup routing tests](../../../../apps/web/src/features/onboarding/setup-state.test.ts),
and the native tests alongside [family adapters](../../../../apps/api/src/features/families/AGENTS.md).
