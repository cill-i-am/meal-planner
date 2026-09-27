# Invitation response

## Sub-features

- Read an invitation as its intended recipient.
- Switch accounts without losing the invitation destination.
- Explicitly join or decline; recover a previously submitted response.
- Explain unavailable, expired, rejected, or already accepted invitations.

## How to get to it (user POV)

Open an authorized test invitation link at `/invitation/$invitationId`.
Sign in or create the intended account when prompted. The page shows
**Join {family name}**, the recipient identity, **Join family**, and
**Decline invitation**. **Switch account** signs out and keeps this link as the
return destination.

An accepted invitation offers **Finish joining your family** and **Continue**.
If another session accepted while a decline was retained, select
**Continue with the accepted invitation** before explicitly finishing the join.
Unavailable links ask the user to obtain a new invitation from the organizer.
This page requires account identity, not an existing selected family.

## Driving it with agent-browser

Use [the shared setup](README.md) with an organizer and separate recipient and
unrelated accounts. Create links only through an authorized test invitation path;
keep full links out of shared screenshots and logs.

| Path | Drive | Proof |
| --- | --- | --- |
| Anonymous entry | Open invitation while signed out, authenticate as its recipient | Returns to the same invitation rather than requiring family creation |
| Join | Check the displayed recipient and select **Join family** | One response operation returns `joined`; selected family opens with the recipient linked once |
| Decline | Select **Decline invitation** on a separate pending invitation | Response returns `declined` and navigates to setup; reopening the link shows **Invitation declined**; no membership/link created by that response |
| Wrong account | Open using the unrelated account; choose **Switch account** | Invitation details protected; after correct login the original invitation is available |
| Invalid/unavailable | Open malformed, missing, expired, or cancelled links | Unavailable feedback, no response mutation or unauthorized details |
| Accepted, link incomplete | Open accepted invitation from an interrupted native fixture; continue | Household link finishes without another acceptance or duplicate person |
| Unknown response | Lose the Join/Decline response and reload | Retained decision and mutation ID are reused |
| Concurrent decision | Retain a decline, then accept in another authorized tab/fixture | First tab does not silently convert its decline into acceptance |
| Account changed | Switch authenticated identity while the screen remains open | Reload/account-change feedback before responding with stale identity |

## Gotchas

Accepted in Better Auth and linked in household storage are separate persistence
steps. The server owns their coordination. Seeing “accepted” is not enough to
prove that the user can enter the household as the correct person.

A response operation cannot demonstrate that the invitation email arrived.
Invitation read permission is recipient-specific; knowledge of an ID is not
permission. Avoid testing with the organizer session when the case requires the
recipient session.

Owners: [recipient UI](../../../../apps/web/src/features/invitations/AGENTS.md),
[invitation application](../../../../packages/invitations/AGENTS.md), and
[server adapters](../../../../apps/api/src/features/invitations/AGENTS.md).
Source checks: [page tests](../../../../apps/web/src/features/invitations/invitation-page.test.tsx)
and [account-only loading](../../../../apps/web/src/features/invitations/invitation-account.test.tsx).
