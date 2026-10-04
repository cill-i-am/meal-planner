# Codebase design coverage

Status: active
Owner: Codex
Baseline: `b6379f0e8fc8a4c6a38f343cbabfbf91a65fe350`
Delivery: justified simplifications merged, deployed and verified

## Outcome and scope

Review the whole codebase with the codebase-design deletion test in up to twenty
substantive passes. Stop earlier if all areas have been examined and the selected
refactors are delivered. A pass may retain every module when its interface earns
its keep. Previous deliveries in PRs #273–#277 are the baseline, not new passes.

The initial assignment contained 764 code, configuration and migration files.
The final gap check adds eleven files: two stylesheets, a motion reference HTML
file, two installed dependency patches, the example environment, two ignore
files, and the vendored launcher, Windows launcher and version metadata. The
complete source/configuration inventory therefore contains 775 baseline files. Review
runtime interfaces, their real callers, test seams and ownership within each area.
Generated files, migrations, lockfiles and vendored code get an ownership and
consumer check; do not hand-edit generated output or remove data protections.
Documentation and local instructions guide each area and are checked for affected
links and obsolete claims.

Keep domain-driven design and feature slices. Retain validation, access checks,
durable receipts, cancellation and exact-command recovery. Replace redundant
interfaces together with their callers. Do not add compatibility paths, upgrade
dependencies or expand product scope to justify a refactor.

## Coverage ledger

Each row records a distinct scope. File counts refer to the baseline assignment;
the final pass checks overlaps, newly changed callers and any omissions. An
inventory or identifier search alone does not complete a pass.

| Pass | Area | Status | Disposition and evidence |
| --- | --- | --- | --- |
| 1 | Entrypoints, Node HTTP host, stack, deployment and runtime configuration | Reviewed | Keep host adapters and config parsing: they own startup, resource lifetimes, API forwarding and stage-specific resources. Small internal-only type exports can be narrowed with later visibility cleanup. |
| 2 | Shared domain and protocol packages | Reviewed | Remove the unused invitation client type alias. Keep schema composition, generated clients, application coordination and recipe scaling: these own protocol validation, replay and documented domain behavior, rather than pass-through interfaces. |
| 3 | API auth, families, invitations and email | Reviewed | Remove unused bound `listOrganizations` and `setActiveOrganization` methods from production and test adapters, and hide internal auth helper types. Keep output fences, atomic native endpoint extensions, deterministic invitation identity and family creator-link recovery. Trusted native fixture creation still uses the bound `createOrganization` method. |
| 4 | Household foundation and shared kernel | Reviewed | Hide the two internal-only live Layers. Keep canonical encoding, digest and identity services: production and deterministic test adapters vary at these real seams. Keep the provenance check and durable admission repository because they enforce household isolation, stable workflow identity and replayable dispatch. |
| 5 | Household people and profiles | Reviewed | Keep the control-plane adapter, purpose-separated identities, profile policy and transactional writers. Their interfaces hide recipient authority, safety confirmation, audit/version updates, departure recovery and mutation receipts. The small command adapters select distinct domain operations; removing them would spread those rules into callers. |
| 6 | Household imports, evidence, batches and meal plans | Reviewed | Hide internal batch/evidence component declarations. Keep the queue writer service type public because exported declaration signatures require it. Keep queue send classification, transactional import authority, integrity checks, replay receipts and approved recipe publication. |
| 7 | Private authority, directory, session and confirmation | Reviewed | Keep native directory/session, lifecycle coordination, socket fencing and confirmation. They enforce synchronous generation/expiry checks, hibernation attachment safety, exact-command recovery and household-only profile writes; deleting them would distribute authority policy across callers. |
| 8 | Private chat, discovery and model adapters | Reviewed | Hide internal discovery byte limits and the internal base model interface. Keep bounded continuity, deterministic topic/proposal selection, participant evidence validation, application acceptance and published SDK streaming/persistence adapters. |
| 9 | Import source resolution, media and acquisition | Reviewed | Hide internal downloader/runtime input types and its default Node client. Keep DNS pinning, public-address checks, credential scope, bounded streaming, checksums, acquisition leases and checkpoint recovery; these are real external and runtime seams. |
| 10 | Import evidence, speech, visual and carousel extraction | Reviewed | Remove the uncalled household carousel repository adapter and its recovery helper, left after PR #277. Keep carousel domain/evidence rules, native household integrity checks and their tests. Keep VisualEvidenceExtractionInput public because exported provider signatures require it. Timestamp checks now target each of the three live evidence adapters separately. |
| 11 | Recipe draft, grounding, review and recovery | Reviewed | Hide internal recipe recovery policy, recovery result and durable host/dependency types. Keep grounding, draft lifecycle, recorded provider dispatch and recipe-only restart machinery: they preserve original evidence, timestamps, generation and unknown-result recovery. |
| 12 | Import orchestration and provider accounting | Reviewed | Hide internal provider retry helpers, Workers AI helpers and Worker composition input type. Keep native task retries, safe checkpoints, provider logging protection and conservative accounting. Correct the logging comment against current binding documentation and installed types; no dispatch or logging settings changed. |
| 13 | Tesco integration and meal-planning service | Reviewed | Replace the Node catalogue HTTP cluster with a feature-owned Effect HttpApi contract and generated-client coverage. Remove manual query decoding, JSON wrappers and the second error hierarchy; keep fixed safe responses, domain schemas and defaults. Hide the internal Tesco Layer factory and synthetic planning repository factory. Keep serialized authentication refresh, the read-only GraphQL allowlist, ranking/revision policy and native persistence. |
| 14 | Web auth, family, onboarding, invitations and recovery | Reviewed | Hide the internal setup progress component. Keep account/family providers, auth retry deadlines, roster command shaping, invitation scopes and retained requests: these own identity, cache lifetimes, exact-command retry and definite-versus-unknown failure behavior. Onboarding composition serves several routes and prevents family loading from leaking into invitations. |
| 15 | Web people, profiles, household status and private interviews | Reviewed | Keep feature-owned Effect operations and state hooks. The former Promise facades are already gone. Profile history pagination, scoped session storage, complete Cause classification, saved private commands, socket admission generations and recovery retain real responsibilities; deleting them would spread safety and recovery rules into React callers. |
| 16 | Web recipe import, route composition and browser journeys | Reviewed | Keep shared household query keys, decoded navigation, route-level identity/runtime composition, generated route output and browser journey page objects. Keys prevent household cache collisions; the page objects centralize real user actions and completion checks across journeys. Earlier Effect migrations already removed redundant operation interfaces. |
| 17 | UI components, styling, browser transport and observability | Reviewed | Keep documented shadcn/Base UI primitives, BaseMotionElement, MotionProvider, responsive overlay lifecycle, form field composition and pending-state accessibility. Keep server transport cookie/identity forwarding, browser telemetry and Effect retry policy. These adapt supported libraries or own resource, accessibility and request semantics. |
| 18 | Worker composition, persistence, infrastructure and native fixtures | Reviewed | Keep separate native binding tokens, private RPC schemas, admitted command routing, Durable Object composition and household SQLite repositories. They preserve authority, provenance, transactional receipts, generation fences, outbox dispatch and crash recovery. Keep native fixtures and immutable migration history; generated schemas/snapshots are not hand-edited. Request cancellation and observability preserve interruption and redact auth paths. |
| 19 | Architecture checks, lint rules, evaluations and instruction tooling | Reviewed | Keep native Alchemy migration/queue regression probes, ownership/architecture checks and supported Oxlint plugin rules. They exercise installed dependency behavior and enforce source boundaries. Keep evaluation scenario/rubric ownership and vendored instruction tooling; the launcher and browser helpers have actual hook/command consumers and are maintained by their upstream owner. |
| 20 | Whole-repo caller graph, public exports, documentation and coverage gaps | Reviewed | Reconcile all 775 source/configuration files, including eleven missed by the initial extension inventory. Retain dependency patches used by pnpm, semantic theme styles and approved visual references. Check changed exports against runtime/test callers and emitted declarations; retain public protocol/domain schemas and genuine adapter seams. Correct the installed Effect tagged-error name in engineering guidance. No unassigned source/configuration files remain. |

## Verification and delivery

For each selected change, trace runtime and test callers before editing. Run
focused behavior tests and checks that prove the changed responsibility. Group
cohesive changes into reviewable PRs; use unsigned conventional commits. Complete
required CI, preview verification, merge, production deployment and preview
cleanup using the authorization already given for this work.

The first five passes selected two unused bound auth methods, one redundant
invitation client type alias and internal-only host/auth/authority exports.
Local validation on October 4: 1,635 tests, 14 Chromium/mobile WebKit family,
food-profile and private-review journeys, typechecks, production build, lint,
formatting, documentation checks and 24 checker tests, and Ultracite doctor passed.
[PR #278](https://github.com/cill-i-am/meal-planner/pull/278) merged as
`d826dfd214a7fcbb5c3403e1139c75076c1d3f0b`. Its hosted CI, preview checks,
production deployment and site smoke checks passed; preview cleanup completed.
Live provider calls and real notifications were not used.

Passes 6–12 select the uncalled carousel repository adapter and 31 internal-only
exports. Declaration generation requires two apparently unused types to remain
public; those exports are retained. A structural timestamp assertion included the
removed adapter; its replacement checks all three live adapters individually.
Local validation of this second batch passed 1,635 tests, including native Worker
and provider Workflow coverage, plus typechecks, production build, lint,
formatting and documentation checks. No tests were removed.
[PR #279](https://github.com/cill-i-am/meal-planner/pull/279) merged as
`f7d558dc83fd291b28d79053e4336b9a6db64ea6`. Hosted CI, preview verification,
production deployment and public site smoke checks passed; preview cleanup
completed. No live acquisition, model calls or notifications ran.

Passes 13–20 select the catalogue contract consolidation and three internal-only
exports. The obsolete projection-helper tests move to real HTTP boundary checks;
new generated-client tests cover all five routes, defaults, invalid inputs and
public output projection. Local validation passed 1,645 tests, typechecks,
production build, lint, formatting, 309 documentation checks and 24 checker
tests. The catalogue remains a Node-host feature; production smoke checks
exercise the deployed Worker/site surface. No live Tesco or paid model calls
were used. Hosted delivery is pending.

At completion, record the reviewed scopes, removed and retained interfaces,
delivery PRs and verification limits here. Paid providers and real household
notifications are not required to prove a deletion or transport refactor.

## Next action

All twenty review scopes are complete. Deliver and verify the catalogue contract
batch, then close this plan. This is an interface/caller/ownership review with
selected refactors, not a correctness audit of every line or a paid-provider
acceptance run.
