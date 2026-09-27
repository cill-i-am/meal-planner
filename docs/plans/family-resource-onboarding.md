# Refactor family setup around saved resources

Status: active
Delivery record: [PR #254](https://github.com/cill-i-am/meal-planner/pull/254)
Owner: Codex, with Cillian for product decisions
Baseline: `630e2d18e9ca3c060e82aaf84a578b33ac902a66` (fetched origin/main)
Delivery: implementation, checks, review, and merge; no deployment

## Outcome and scope

Create the real family when a valid name is submitted. Update that family and
its people through shared Effect HttpApi contracts and server operations.
Family setup is `in_progress` or `complete`; completion allows the next app
stage without making the family immutable. Routes own navigation. Remove
account navigation checkpoints, paused setup, and persisted form drafts.

Keep Better Auth identity/access separate from household people. The server
coordinates organization creation and creator linking. Slugify the name and
resolve collisions. Confirm recipients before invitations. Keep successful
operations when a later operation fails. Preserve access, stale-edit, private
output, and repeat-safe write protections.

Use the existing TanStack Query/effect-query stack. Operations return saved
resources and typed failures and remain callable independently of screens.
Production agent tools, LiveStore, chat UI, and model/protocol selection are
deferred. Use the family and invitation slices as the reference architecture for subsequent
features. Continue iterating on the reference against working code.

## Implementation sequence

1. Define family contracts and persistence, including retry identity and setup
   state. Keep useful people contracts and lifecycle rules.
2. Implement authenticated resource operations and server coordination.
3. Replace checkpoint-dependent UI and navigation together; remove obsolete
   contracts, endpoints, and storage fields with an explicit data migration.
4. Verify the name → people → confirmation journey, failures, access, and
   concurrency through the real boundaries.
5. Review the resulting code and record measured simplification, remaining
   limitations, and conventions worth reusing. Complete repository delivery.

## Acceptance

- [x] Create returns one real family with its linked creator; repeated and
  concurrent requests do not duplicate it.
- [x] A lost response or partial creator-link failure can be retried safely.
- [x] Family name collisions do not require globally unique display names.
- [x] Family reads and edits return structured resources with relevant versions
  and timestamps. Actor identity comes from authentication.
- [x] Person reads, edits, and correction identify their family/person and retain
  existing membership and lifecycle protections.
- [x] Members → confirmation and logout do not save navigation state.
- [x] Reloads read saved family data; default entry is Name without a family,
  Members while incomplete, and the app after completion.
- [x] Recipient confirmation is explicit; a roster person does not imply access.
- [x] Conflicting edits, invalid input, missing access, transient failures, and
  uncertain writes retain their useful distinctions.
- [x] Existing persisted family/person data survives the schema change; obsolete
  screen/draft persistence is removed rather than kept as a parallel path.
- Local tests, type checks, repository checks, and browser verification have
  passed. [PR #254](https://github.com/cill-i-am/meal-planner/pull/254) is the live
  record for hosted checks, review, and merge. See the local validation record below.

## Running implementation decisions

Add decisions here as the implementation resolves them. Record the reason,
affected boundary, and verification. Supersede earlier entries explicitly if
the evidence changes the choice.

| ID | Topic | Decision and reason | Verification/status |
| --- | --- | --- | --- |
| D01 | Checkout | Reuse the clean existing checkout on `codex/family-resource-onboarding`; fetched main matches the audit baseline. | Confirmed clean before branching. |
| D02 | Delivery scope | Refactor auth through completed family setup on the existing stack. Assess app-wide patterns afterward. | Agreed in the architecture discussion. |
| D03 | Family persistence | Put family setup status and the creation receipt in auth D1 beside the organization. The organization remains the sole mutable name/slug owner. Commit organization, owner, and family metadata atomically before linking the creator in household SQLite. This closes the native API's separate organization/member write gap. | Implemented in the auth persistence adapter; real D1 race/replay tests pass. |
| D04 | Version ownership | Family edits own one family version; existing person versions remain per person. Completion is idempotent and does not freeze later edits. Names may change without changing the slug. | Contract and adapter implemented; conflict/replay checks pass. |
| D05 | Creation identity | Scope a client-generated mutation ID to the authenticated actor; derive a stable organization ID server-side. Retain the original creation name and creator display name only as a private retry receipt, not an editable family draft. Slug uniqueness is enforced in D1. | Same-key/different-input and partial-link checks pass. |

| D06 | Browser ownership | Query keys are `families / userId / familyId / resource`; lists use the user scope. Successful people writes invalidate that family's roster. React and the URL own unsubmitted forms and navigation. | Generated-client and UI tests pass. |
| D07 | Request storage | Retain only submitted commands in account/family-scoped localStorage, with a separate entry for each mutation ID. Keep the payload unchanged while its outcome is unknown. Release confirmed results and known rejected commands. | Reload and storage-failure browser tests pass; each submitted key has its own storage entry. |
| D08 | API resource scope | People operations use `/v1/families/:familyId/people`, with PATCH/DELETE on individual people. Resolve live membership for the URL family rather than relying on whichever family another tab selected. | Native integration tests confirm URL-family authorization and changed-account rejection. |
| D09 | Invitation response | One server operation accepts/declines the invitation and completes the household link. A retry reads the invitation's saved state before repeating effects. Adding a person still requires separate explicit invite consent. | Real D1 recipient and interrupted-link replay tests pass. |
| D10 | Migration | Backfill family metadata from existing organizations, memberships, and completed checkpoints before dropping account progress fields. Keep existing household records intact. Carry interrupted creator-link identity forward. | Consolidated generated schema migration plus data backfill; real D1 migration tests pass. |
| D11 | Native organization writes | Disable public native organization create/update paths. The family auth adapter owns their atomic persistence and version rules. Native identity, membership, invitations, and output-fence boundaries remain with Better Auth. | Native HTTP bypass tests pass. Low-level household fixtures use a test-only internal organization factory. |
| D12 | HTTP admission | Use a small supported Better Auth plugin endpoint for session/origin/rate-limit admission before app-owned Effect operations. Forward refreshed cookies and retry headers. This preserves protections that direct server `auth.api` calls do not supply. | Checked against installed Better Auth 1.7.2 and its official plugin/rate-limit documentation; Native auth HTTP tests pass. |

| D13 | Read and recovery semantics | GET does not write household data. An incomplete family remains readable with its saved name, status, and timestamps. The roster identifies a missing creator link. POST `/v1/families/:id/resume-creation` finishes the same server receipt; the roster offers it after a reload or on another device. | HTTP test confirms GET does not invoke creator bootstrap. Recovery uses the same mutation ID. |
| D14 | Rename receipts | Keep rename request receipts for the lifetime of the family. A delayed retry returns the current family without overwriting later edits. Reusing the key with a different payload is a conflict. | Real D1 delayed-replay and changed-payload tests pass. |
| D15 | Migration of uncertain writes | Refuse to drop old checkpoint fields while a submitted person or invitation request is unresolved. Finish those requests with the previous application before applying the migration. Interrupted family creation can migrate because its server receipt is carried forward. | A real D1 migration test verifies rejection preserves the command, then verifies successful backfill and field removal. No deployment is part of this task. |
| D16 | Selected family | Keep the family ID in setup URLs and generated-client paths. Refresh the shared Better Auth session after changing its active organization for the rest of the app. | Type checks and native multi-family boundary tests pass. |

| D17 | File boundaries (superseded by D19–D22) | `packages/household-api` owns public resource schemas and generated clients. Auth-side family modules own HTTP admission, orchestration, and D1 persistence. The existing household domain keeps people rules and SQLite. Frontend `person-commands.ts` owns form drafts and composed form commands; these no longer leak into the shared API package. | All workspace type checks and focused caller tests pass. |
| D18 | Retry owner | Effect owns the bounded retry schedule for family operations. Disable TanStack Query retries for those queries so the two layers do not multiply attempts. Known auth, validation, and conflict responses do not get automatic Effect retries. | Error-specific UI tests pass. |

| D19 | Feature packages | `@meal-planner/families` and `@meal-planner/invitations` own public contracts, generated clients, application operations, typed failures, and dependency interfaces. Their application entrypoints have no app, database, Better Auth, or Worker dependencies. This supersedes D17's broad household-contract ownership. | Package type checks, builds, and invitation application tests pass. |
| D20 | Host adapters | `apps/api/features/families` owns D1 persistence and HTTP. Auth exposes deliberate HTTP admission, SDK, and schema boundaries. Household membership adapters own identity derivation and RPC details. The Worker composition root supplies them to package services. Co-location in D1 does not assign family ownership to auth. | Native D1 family tests and invitation acceptance/recovery tests pass. |
| D21 | Frontend slices | `family` owns reusable family queries and roster management; `onboarding` owns the setup presentation; `invitations` owns recipient interaction. Account loading belongs to auth. Invitations use account identity without loading the onboarding family context. Shared account layout/status/error presentation lives in components. | Full frontend suite and a new real-provider invitation isolation test pass. |
| D22 | Public boundaries | Other features consume curated public entrypoints or explicit boundary subpaths. Browser code consumes package contracts/clients, never server application capabilities. Submitted-request recovery is a named reusable browser capability. | Focused architecture tests enforce public imports, dependency direction, and package independence. |
| D23 | Reference status | Cillian explicitly requested these boundaries as the reference architecture for future application work. The reference is maintained in `docs/reference/family-api.md` and linked from the engineering feature-slice standard. Existing unrelated features are migrated when worked on, rather than silently described as conforming. | Approved in this conversation on 27 September 2026; final local integration checks pass; repository delivery is tracked in PR #254. |

| D24 | Agent intent layer | Small local AGENTS.md nodes cover the family/invitation packages, their server adapters, and the related browser slices. The intent index links these nodes to canonical references; it is distinct from runtime import intents. | Requested on 27 September 2026 using the Intent Systems article; scope excludes unrelated application architecture. |
| D25 | User feature map | Auth/recovery, setup, people, invitations, and cross-feature journeys have user entry points, driver instructions, observable outcomes, and known proof limits. Source review, fixture UI checks, native tests, and real integrated journeys remain distinct evidence. | Requested using the pstack feature-map article; no cloud-agent installation or recurring automation. |

## Validation and delivery record

Local checks completed on 27 September 2026:

- Full API suite: 1,180 tests passed, followed by one added native family-resource
  integration test. That test covers creation, replay, linked creator, adding a
  child, completion, later rename, and a persisted-runtime restart through D1,
  Worker RPC, and household SQLite.
- Full web suite: 228 tests passed. The final frontend module move was then checked
  with 31 focused form and recovery tests, including the final interrupted-creator
  recovery path. The four family HTTP tests also passed after that refinement. Household contracts: 29 tests passed.
  Other API contracts: 54 tests passed.
- Repository architecture/scripts: 168 tests passed; the 12 infrastructure
  structural tests passed after updating the assertion for the two auth schema
  sources. This was a source-inventory update, not removal of a check.
- Canonical `pnpm check`, `pnpm build`, lint, formatting, 24 documentation-tool
  tests, the documentation checker, and Ultracite doctor passed. A transient
  dependency-link issue during removal of unused `dequal` was fixed with a
  frozen-lockfile install; no dependencies were upgraded.
- Browser walkthrough used the real frontend with a local synthetic API fixture:
  Name → Members → add child → correct name in the mobile drawer → Confirmation
  → application. Continue left setup in progress; confirmation completed it.
  Desktop and mobile screenshots were inspected. The confirmation screen's axe
  scan reported zero WCAG 2 A/AA violations. This is visual/client verification;
  native server integration is covered separately above.

The migration intentionally stops if an old submitted person or invitation
command is unresolved. Finish those requests with the previous application
before applying it. No deployment has been performed or authorized here.

The configured 1Password signer succeeded on retry. Implementation commit:
`7aba70e` (`refactor: establish family and invitation feature architecture`).
[PR #254](https://github.com/cill-i-am/meal-planner/pull/254) tracks hosted checks,
review, and merge against the signed source. No deployment is included.
The feature-package and frontend-slice organization is the agreed reference
architecture. Agent runtime/tooling and a representative post-setup LiveStore
evaluation remain future work.

### Reference architecture iteration

The final local source passes 1,181 API tests across 94 files and 230 web tests
across 34 files. Both new feature packages pass their tests. Workspace type
checks, production builds, lint, formatting, and the documentation checker pass.
The full repository test run passed 182 checks; its tracked-source check initially
rejected the newly untracked package files, then passed after staging them. No
check was weakened. One native private-output test timed out under the first
parallel full run, passed unchanged in isolation, and passed in the final full
API run.

Browser verification repeated creation, adding a child, confirmation, and entry
to the app against the local synthetic API. The real frontend completed the
journey and the fixture retained the completed family and both people. The
confirmation accessibility scan reported zero WCAG 2 A/AA violations. Native
persistence and auth behavior are verified separately by the API suite.

### Intent layer and feature map

On 27 September 2026, the scoped agent guidance and behavior map were added from
the merged reference architecture. Both requested articles were read; the X
article required a public rendering. No application runtime behavior changed.
The stale web README description of unavailable password recovery was corrected:
forms and token handling exist, while delivery callbacks remain mocks.

Validation: documentation links pass across 300 Markdown files; all 24
documentation-tool tests pass; repository formatting and whitespace checks pass.
The documented frontend command started Vite on an owned port. Browser navigation
verified invalid reset → reset request → login → signup using the listed controls.
Local screenshots are retained in ignored `artifacts/auth-family/`. This checks
frontend entry points only. Authenticated family journeys, native persistence,
fault injection, and actual mail delivery were not rerun for this documentation
change; the feature map specifies their prerequisites and evidence requirements.
