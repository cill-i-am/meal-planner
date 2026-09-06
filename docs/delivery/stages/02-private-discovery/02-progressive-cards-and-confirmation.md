# Work Item 02 — Progressive cards and confirmation

- Status: In progress (2026-09-06).
- Implementation base: `39e0b2eb97390fc81f030b10b2feeddfa5bfee74`.
- Authorized outcome: private proposed cards, correction, rejection, explicit
  confirmation, safety status, and current-version conflict handling.

## Scope and product consequence

The admitted native session owns tentative cards and their revisions. Reviewing,
correcting, or rejecting a proposal does not write the household profile. An
adult explicitly confirms a closed change to their own profile; the UI explains
that the confirmed fact becomes visible to the household. Dependant assistance
belongs to Work Item 04. Ordinary preferences, strong dislikes, hard constraints,
and explicit no-known-hard-constraints retain their existing product meanings.
Changing or removing a hard constraint requires the separate explicit safety
confirmation; an ordinary correction cannot bypass that command.

Production provides an honest empty/proposed state. Synthetic local fixtures
produce the initial cards through same-session storage for this slice's tests.
There is no production proposal-injection RPC, manual card-creation product,
fake assistant activity, or model/provider call. Real adaptive proposals and
their quality evidence belong to Work Item 03.

## Confirmation ordering

1. The participant reviews a card revision and current shared profile version.
   An admitted socket command synchronously freezes one exact pending closed
   change, card revision, expected profile version, and mutation ID. The browser
   retains the exact command before sending. The session records it before any
   outgoing await. A pending confirmation prevents all session completion and
   other card mutations, including commands from another device.
2. The browser continues that pending mutation using an authenticated same-origin
   HTTP POST containing only session reference, mutation ID, and the server-issued
   originating socket generation header. A paused request cannot borrow a later
   connection generation after revocation. Fresh canonical
   auth and roster reads derive the participant binding and household admission.
   A narrow internal session RPC verifies that immutable binding, the currently
   admitted output generation, and the exact retained pending mutation. It
   releases only the explicitly confirmed closed command. The browser cannot
   provide a target person, actor, source, transcript, or replacement command in
   the HTTP request. No credentials are retained in private children.
3. A dedicated trusted Household method hardcodes interview provenance and
   rechecks the linked active adult equals the bound participant in its own
   SQLite transaction. It records a durable digest and terminal outcome for
   success or definitive policy rejection. Successful profile version/audit and
   this terminal receipt commit atomically. Shared state carries no transcript,
   session ID, card ID, or private draft provenance. Exact replay returns the
   same terminal outcome before attempting another profile write; collisions
   cannot overwrite it. The source participates in mutation identity.
4. Only the canonical terminal result settles private pending state. Missing
   receipts, timeouts, and lost acknowledgements retain the exact pending
   command. Reconnection or restart replays the same mutation through fresh
   admission and the same canonical receipt, then settles the card. There is no
   timeout-based rejection, guessed success, new mutation ID, or automatic
   rebasing. Completion remains blocked until this settlement is durable.
5. Revocation prevents new release for dispatch and private output. A command
   already released by the generation check may reach Household after revocation
   and settle under canonical current authority; this
   protocol does not cancel in-flight mutations. Terminal output still passes
   through the existing physical final-send fence. A restored participant can
   recover retained pending state under a new admitted generation.

A stale version or conflicting fact is shown as needing review. The UI reads
the latest shared facts and requires an explicitly updated card review and a
new confirmation before another mutation. A target fact must equal the saved
review even when its profile version matches: revising records the canonical
fact before a separate confirmation. Terminal history retains that immutable
review if the current shared fact later changes or disappears. The UI never
silently resends against a new profile version. Rejected proposals and completed sessions remain private
read-only history. Card/history projections are bounded and paged within the
existing 32 KiB private-frame limit.

## Required evidence

Native runtime and actual-browser proof cover correction/rejection without
shared writes, explicit ordinary and safety confirmation, immutable version and
interview audit provenance, stale concurrent edits, canonical participant/link
checks, exact lost-result recovery, completion races across devices, restart,
revocation, and private/shared payload boundaries. Independent review checks
the final immutable implementation head. Model quality, dependant flows,
deployment, and the later cumulative Stage 2 exit are not exercised here.

## Local verification — 2026-09-06

The local full-suite runs and affected reruns cover 1,272 passing tests: 900 API,
130 web, 62 shared-contract, and 180 root tests. The root suite's Alchemy loader
fixture initially hit the sandbox's local IPC restriction; its complete
22-test file passed with local socket permission. The tracked-source
architecture check passed after including the new production files in the
index. These were test-environment preparation issues, without production
changes to accommodate them. Root type checking, lint, formatting, and builds
passed. Both affected Drizzle generators twice reported no further schema
changes after the new ordered migrations; existing migrations remain intact.

The native Household suite passes 82 tests, including 10 confirmation cases;
the private-output suite passes 36. Together these exercise private correction
and rejection, separate safety reduction, bounded pages and completed history,
stale versions and cross-source mutation collisions, lost-result recovery after
restart, completion from another device while a canonical commit is pending,
retained policy rejection across authority loss and return, copied references,
substituted bodies and non-interview commands, and final-output fencing. A
paused old-generation HTTP request is proven to dispatch zero Household
commands after revocation; the explicit fresh-generation retry commits once.
The privacy assertions inspect Household SQL, coordinator metadata, and runtime
logs for synthetic transcript and private-card identifiers.

The private UI checks additionally cover immutable terminal review after the
shared fact changes or disappears, same-version review mismatch requiring an
explicit correction, and direct-client rejection of every target-fact command
until its saved review matches the canonical current value.

## Browser acceptance in progress

The actual local browser has proved correction and rejection remain private,
followed by explicit ordinary and hard-constraint confirmation with canonical
interview/self audit. A stale proposal cannot be confirmed until an explicit
private revision records the current profile version. During a deliberately
paused canonical result, the Household profile contains one committed fact,
the private session retains the original pending mutation, and completion is
disabled. The browser retains its exact submitted command in session storage.

This run exposed two UI defects now covered by corrections and regressions:
successful sign-in/sign-up refreshes the organization queries that previously
retained anonymous errors, and a canonical private confirmation settlement
invalidates the existing shared profile/history queries. The latter does not
publish private cards into the cache or clear an ambiguous manual command.
Remaining browser acceptance covers dropped-result recovery after restart,
safety reduction, completion, and the final build's account and shared-profile
refresh behaviour. Independent immutable-head review and repository delivery
are also pending. No completed browser acceptance or deployment is claimed.
