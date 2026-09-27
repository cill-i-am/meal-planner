# Family resources and setup

The family API creates and edits a real family. A family uses a Better Auth
organization for its identity, name, slug, membership, and access. Household
SQLite owns its people and profiles. Creating the family links its creator on
the server before returning success.

## Operations

The shared Effect HttpApi contract is in
[`family-api.ts`](../../packages/families/src/family-api.ts). Browser forms
use its generated client through Effect Query and TanStack Query. Future agent
tools can call the same operations with authenticated authority.

| Method and path | Input | Result |
| --- | --- | --- |
| `GET /v1/families` | Authenticated account | Families the account has joined |
| `POST /v1/families` | `name`, `mutationId` | Saved family with linked creator |
| `GET /v1/families/:familyId` | Authorized family ID | Current family |
| `PATCH /v1/families/:familyId` | `name`, `expectedVersion`, `mutationId` | Current family after the rename |
| `POST /v1/families/:familyId/resume-creation` | Authorized family ID | Finishes an interrupted creator link using its server receipt |
| `POST /v1/families/:familyId/complete-setup` | Authorized family ID | Family with setup marked complete |
| `GET /v1/invitations/:id` | Invitation ID | Recipient-authorized invitation view |
| `POST /v1/invitations/:id/response` | `decision: accept\|decline`, `mutationId` | Family ID and `joined\|declined`; acceptance includes household linking |

Each family response contains `id`, `name`, `slug`, `createdAtEpochMs`,
`updatedAtEpochMs`, `version`, `canManage`, and `setup`. Setup is either
`{ status: in_progress }` or `{ status: complete, completedAtEpochMs }`.
Completion allows the next application stage. It does not prevent later edits.
`canManage` reflects the caller's current owner membership; the server checks
membership again for writes.

People have independent versions and operations. See the
[people API reference](household-people-api.md). A roster person is not an auth
member. Adding an email does not authorize an invitation; the UI requires the
user to select invitation and submit the shown recipient.

## Ownership and recovery

The family persistence adapter atomically creates the organization, its owner membership, and
a family control-plane record in D1. That record owns setup completion and the
private creation receipt. The organization owns the mutable name and slug;
there is no second editable family draft. Household creator linking is a
separate idempotent write, not a distributed transaction.

Creation keys are scoped to the authenticated account. The server derives a
stable organization ID from the account and key. It slugifies the name and uses
a deterministic suffix when another organization already owns that slug.
Renaming the family keeps its slug stable.

The creation receipt retains the original name, creator display name, and
mutation ID so retries use identical household input. Reads never bootstrap a
person. An incomplete family still returns its saved name, status, and timestamps.
The roster reports an available creator slot until the creator is linked; the UI
then offers the explicit resume operation, including from another device.

Renames check the family version in the same D1 batch as the name update and
receipt. Receipts live as long as the family. Replaying identical rename input
returns the current family, without undoing later edits. Reusing the key for
different input returns `mutation_collision`. Completion is naturally
idempotent and increments the version only once.

The browser retains submitted commands in account/family-scoped localStorage
until their result is known. Each mutation ID has its own entry. It does not
retain unsubmitted drafts or screen positions. Unknown outcomes reuse the same
payload and ID; definite rejections allow correction. Storage failure prevents
a new request from being dispatched. Bounded Effect retries use exponential
backoff and jitter for transient failures. Retry timing does not replace server
receipts or access checks.

## Screens, cache, and auth

Name creates the family. Members reads and edits its saved people. Continue
navigates to confirmation without a write. Confirmation completes setup. Setup
URLs keep the selected family ID. The default entry is Name without a family,
Members for incomplete setup, and the application after completion.

TanStack Query owns remote resource state. Family query keys include the account
and family ID; roster writes invalidate that family's people query. React owns
form fields and dialogs. Selecting a family also updates and refreshes the Better
Auth session for application routes that still use its active organization.

The API Worker admits family requests through a supported Better Auth plugin
endpoint, preserving native session, origin, rate-limit, refreshed-cookie, and
expected-account handling. The family handlers then check live membership.
Public native organization create/update endpoints are disabled so they cannot
bypass family receipts and versions. Auth identity, invitations, membership
changes, and private-output fences retain their existing boundaries.

Implementation choices and validation are recorded in the
[running decision log](../plans/family-resource-onboarding.md). This is the
reference architecture for new features and for existing features as they are
changed. LiveStore and agent runtime/tooling remain separate decisions.

## Reference architecture

Organize by capability across runtimes. A package owns reusable application
behavior when more than one host needs its contracts or operations. Apps own
framework and provider adapters. Keep small features flat; add subfolders when
the code needs them, not to fill a layer diagram.

| Owner | Responsibility | Entrypoint |
| --- | --- | --- |
| Family package | Family values, HTTP contract/client, use cases, persistence and creator-link interfaces | [`@meal-planner/families`](../../packages/families/src/index.ts), [`./application`](../../packages/families/src/application.ts) |
| Invitation package | Invitation response contract/client, acceptance/decline orchestration, authority and membership interfaces | [`@meal-planner/invitations`](../../packages/invitations/src/index.ts), [`./application`](../../packages/invitations/src/application.ts) |
| API family feature | HTTP error projection, D1 persistence, family schema | [`families/index.ts`](../../apps/api/src/features/families/index.ts), [`schema.ts`](../../apps/api/src/features/families/schema.ts) |
| API invitation feature | HTTP handling and request-scoped Better Auth adapter | [`invitations/index.ts`](../../apps/api/src/features/invitations/index.ts) |
| API auth feature | Authenticated account admission and native identity/access integration | [`auth/http.ts`](../../apps/api/src/features/auth/http.ts), [`auth/index.ts`](../../apps/api/src/features/auth/index.ts) |
| Household adapters | Creator and invited-person linking; private identity and Worker mechanics | [`households/membership.ts`](../../apps/api/src/features/households/membership.ts) |
| Web family feature | Family queries, selection, people commands, and roster management | [`family/index.ts`](../../apps/web/src/features/family/index.ts) |
| Web onboarding feature | Name, Members, and Confirmation screens and route composition | [`onboarding/index.ts`](../../apps/web/src/features/onboarding/index.ts) |
| Web invitations feature | Recipient-facing invitation presentation | [`invitations/index.ts`](../../apps/web/src/features/invitations/index.ts) |
| Browser request recovery | Retain submitted commands until their outcomes are known | [`request-recovery/index.ts`](../../apps/web/src/features/request-recovery/index.ts) |

Application services receive domain values and Effect capabilities. They do not
receive HTTP headers, database connections, React state, or Worker bindings.
Adapters translate those details at the owning boundary. Invitation authority
and membership adapters are created for one incoming request and retain that
request's authenticated context; they are not shared between users.

The API Worker composes services and adapters. The family store retains atomic
D1 guards for membership, versions, and receipts. Extracting a domain rule must
not replace a database-enforced race check with an earlier in-memory check.
Family identity/name and setup remain separate records in the same transaction;
physical storage and feature ownership answer different questions.

Frontend features own their query keys and operations. Other features use their
public interfaces. Onboarding composes account and family loading; invitations
only require the account. Form drafts remain in the frontend feature and are
not shared API types. Shared visual components do not import product features.

The [boundary checks](../../scripts/family-feature-boundaries.test.ts) guard
public imports, dependency direction, and package independence. Package tests
exercise application behavior without a host; native integration tests exercise
the real adapters and persistence. Existing unrelated slices are not claimed to
follow every convention until they are migrated.
