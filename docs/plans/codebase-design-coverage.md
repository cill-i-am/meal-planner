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

The tracked baseline contains 764 code, configuration and migration files. Review
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
| 6 | Household imports, evidence, batches and meal plans | Pending | |
| 7 | Private authority, directory, session and confirmation | Pending | |
| 8 | Private chat, discovery and model adapters | Pending | |
| 9 | Import source resolution, media and acquisition | Pending | |
| 10 | Import evidence, speech, visual and carousel extraction | Pending | |
| 11 | Recipe draft, grounding, review and recovery | Pending | |
| 12 | Import orchestration and provider accounting | Pending | |
| 13 | Tesco integration and meal-planning service | Pending | |
| 14 | Web auth, family, onboarding, invitations and recovery | Pending | |
| 15 | Web people, profiles, household status and private interviews | Pending | |
| 16 | Web recipe import, route composition and browser journeys | Pending | |
| 17 | UI components, styling, browser transport and observability | Pending | |
| 18 | Worker composition, persistence, infrastructure and native fixtures | Pending | |
| 19 | Architecture checks, lint rules, evaluations and instruction tooling | Pending | |
| 20 | Whole-repo caller graph, public exports, documentation and coverage gaps | Pending | |

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
Deployment is pending. Live provider calls and real notifications were not used.

At completion, record the reviewed scopes, removed and retained interfaces,
delivery PRs and verification limits here. Paid providers and real household
notifications are not required to prove a deletion or transport refactor.

## Next action

Review household imports, evidence and batches, then work through the ledger
without repeatedly revisiting only the smallest browser modules. The first five
passes have selected a small interface cleanup; validation and delivery are
pending.
