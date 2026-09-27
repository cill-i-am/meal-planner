# Cross-feature journeys

## Sub-features

- Account → family → people → completion.
- Organizer invitation → recipient account → joined household.
- Reload, interrupted writes, and account/family isolation.

## How to get to it (user POV)

Start with the entry points in [the map](README.md). Use distinct named browser
sessions for organizer, recipient, and unrelated account. Record each role and
which family it is allowed to access; no real credentials belong in the report.

## Driving it with agent-browser

### Create and complete

1. Create a disposable account through signup and enter setup.
2. Name the family. Record its returned ID; confirm the creator appears once.
3. Add a child and an adult without invitation. Reload and verify all three people.
4. Edit one person's name, cancel another edit, and verify the saved results.
5. Select **Continue**. Confirm setup is still `in_progress`.
6. Select **I’ll do this later**. Confirm completion, then stop at `/`.
7. Reopen the explicit family review URL. Verify saved people remain editable
   according to the account's permissions.

### Invite and join

1. From the organizer's saved adult, select **Invite to join** and confirm the
   displayed test recipient. Record invitation creation separately from delivery.
2. Open the link in the recipient session. First exercise wrong-account recovery
   with an unrelated account, then sign in as the intended recipient.
3. Select **Join family**. Reload and verify the existing person is linked once.
4. Confirm that recipient access matches member permissions and that the
   organizer still sees the same roster.

### Preserve uncertain writes and isolate accounts

1. With an owned fault fixture, lose a create/person/response result after the
   server may have committed it. Record which boundary was interrupted.
2. Retry while the submitting screen stays mounted. Verify its original mutation
   ID and payload are reused. In a separate run, reload after response loss and
   verify that reads show saved resources without replaying a browser mutation.
3. Inspect the saved resource through the real read path; verify one effective
   write. Do not use a success toast as duplicate-write proof.
4. Switch to an unrelated account. Confirm no previous family data or retained
   request is exposed or submitted for that account.
5. For two families under one account, switch explicit family URLs and verify
   that roster reads, writes, and invalidation stay with the selected family.
6. Where expected-version updates are involved, perform a competing edit and
   verify conflict handling rather than a silent overwrite.

## Gotchas

The [common evidence rules](README.md#evidence-and-limitations) apply to every
step. A fixture that replaces the API does not prove cookies, D1 transactions,
Worker RPC, or durable persistence. Native integration tests do not prove a
visible control is reachable. Report those checks separately.

Do not create an entire post-setup test suite from the exit links. Discovery,
recipe import, planning, and shopping remain outside this map. Missing full-app
runtime or mail/fault fixtures must be listed as unexercised prerequisites.
