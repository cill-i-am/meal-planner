# Family people

## Sub-features

- Add an adult without an account or a managed child.
- Explicitly invite an adult during creation or from the saved roster.
- Edit names and confirm removals through a desktop dialog or mobile drawer.
- Recover submitted person/invitation requests after uncertain responses.

## How to get to it (user POV)

From **Your family**, select **Add someone else**. On `/setup/people`, use
**Name**, **Adult** or **Child**, and **Invite them to join** for an adult.
The submit action is **Add person**, or **Add and invite** when invitation is
selected. **Cancel** returns to review without saving the unfinished person.

Both review and **Your family so far** on the Add screen expose roster actions.
Use **Manage {name}** → **Edit name** or **Remove from family** when permitted.
An eligible adult shows **Invite to join** or **Invite again**. An organizer and
a regular member have different available actions.

## Driving it with agent-browser

Use [the shared setup](README.md), an organizer, and disposable roster entries.
Scope controls to the intended person's row; use its accessible name and, when
necessary, `data-roster-person-id` from the rendered DOM.

| Path | Drive | Proof |
| --- | --- | --- |
| Managed adult | Add **Name**, keep **Adult**, leave invite unselected, select **Add person** | One saved adult after reload; no invitation request |
| Child | Select **Child**, enter **Name**, submit | One managed child; no enabled invitation choice |
| Invite with add | Select Adult and invitation, enter **Email**, select **Add and invite** | Person saved once; invitation targets the displayed address; delivery recorded separately |
| Invite saved adult | Select **Invite to join**, enter recipient, confirm **Invite {name}** | Existing person is invited; roster count does not increase |
| Correct name | **Manage {name}** → **Edit name**; update **Name**; **Save changes** | Same person ID, updated name after reload |
| Cancel edit | Change a field, select **Cancel** or press Escape | Saved person unchanged; an in-memory Add form is preserved |
| Remove | **Manage {name}** → **Remove from family**; inspect and confirm the named action | Correct person removed after reload; affected membership is handled by the server |
| Cancel removal | Open removal and cancel | Person and membership remain |
| Permission view | Repeat as a regular member | Only permitted actions appear; own-name editing does not grant organizer actions |
| Mobile | Repeat edit at a narrow viewport and resize while open | Drawer/dialog keeps the intended person and unsaved values; cancel still leaves data unchanged |
| Unknown write | Interrupt a submitted mutation, reload, retry | Original key/version/payload reused; one effective change |

If a person saves but its invitation is rejected, expect a partial-success
message. Review that person and correct the invitation; do not add another person.
Switching Adult → Child → Adult clears invitation consent. An email field alone
does not authorize sending an invitation.

## Gotchas

A roster person is not necessarily an authenticated account or auth member.
The creator cannot be treated as an ordinary removable unlinked profile.
Pending invitation removal can display **Cancel invitation & remove**.
Capture the exact person and action in removal evidence.

Cancel preserves a local Add form while the screen stays mounted; logout/reload
does not promise to restore unsent fields. Unknown submitted requests follow a
different recovery path. Completion leaves later corrections possible.

Owners: [browser family](../../../../apps/web/src/features/family/AGENTS.md),
[people API](../../household-people-api.md), and household persistence.
Source checks: [people screen tests](../../../../apps/web/src/features/onboarding/people-pages.test.tsx)
and [person save tests](../../../../apps/web/src/features/family/person-save.test.ts).
