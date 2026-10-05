# Feature map

Start with the changed user outcome, then follow its owner and proof. This map
describes the current source tree; an entry is not a claim that the path has been
deployed or quality-evaluated. Read the linked local instructions and relevant
[engineering topics](../engineering/README.md), not every document.

| Outcome or capability | Domain owner and entrypoint | Contract and rules | Observable proof |
| --- | --- | --- | --- |
| Sign in, recover access, create a family, manage people and respond to invitations | [Auth/family intent map](../intent-layer.md), [server composition](../../../apps/api/src/auth-family.ts) | [Family API](../family-api.md); packages `families`, `invitations` and `household-api` | [Auth/family journeys](auth-family/README.md) |
| Edit household-visible food profiles | [Profile intent map](../food-profile-intent-layer.md) | [People API](../household-people-api.md), household profile versions and receipts | [Profile journey](food-profiles/README.md) |
| Discuss shared family tastes and review proposed food facts | [Conversation UI](../../../apps/web/src/features/agent-conversations), [family roster query](../../../apps/web/src/features/family/people-queries.ts) | [Agent conversations](../agent-conversations.md); the roster must load and contain the proposed fact's person before review | [Conversation browser tests](../../../apps/web/src/features/agent-conversations/our-tastes-page.test.tsx), [fact review tests](../../../apps/web/src/features/agent-conversations/conversation-surface.test.tsx) |
| Discuss private food needs and confirm selected facts | [Private output feature](../../../apps/api/src/features/private-output), [private interview UI](../../../apps/web/src/features/private-interviews) | [Private discovery](../private-discovery.md); `private-interview-api` contract; household owns confirmed public facts | [Private-review browser journey](../../../apps/web/e2e/private-review-journey.spec.ts), native private-output tests; [quality eval pack](../../../evals/private-discovery/README.md) is separate evidence |
| Import, review and save a recipe | [Recipe-import UI](../../../apps/web/src/features/recipe-import), [household import authority](../../../apps/api/src/features/households/recipe-import), [acquisition adapters](../../../apps/api/src/features/imports) | [Import lifecycle](../recipe-import.md), [recipe content](../recipe-content.md); `recipe-import-api` and `recipe-domain` | Browser component tests, household boundary integration tests, native import queue/restart tests and media-container tests; no full import Playwright journey yet |
| Plan from approved recipes | [Meal-planning domain](../../../apps/api/src/features/meal-planning/meal-plan.ts) | [Product domain](../product-domain.md) includes broader planned intent, not proof of a complete product flow | [Current deterministic tests](../../../apps/api/src/features/meal-planning/meal-plan.test.ts); no complete weekly-planning browser journey claimed |
| Read Tesco products | [Catalogue HTTP](../../../apps/api/src/features/tesco/catalogue/catalogue.http.ts) and Tesco adapters | [Root API contract](../../../apps/api/src/app/routes.ts); retailer data does not own household intent | Catalogue handler/contract tests; `dev:tesco` is the focused Node host, not the Website stack |
| Persist household state and isolate access | [Household authority](../household.md) | [Ownership explanation](../../explanation/household-authority.md), live membership and guarded transactions | [Household boundary integration tests](../../../apps/api/src/features/households/household-boundary.integration.test.ts), native Worker tests |
| Account for model-provider use | [Provider accounting](../../../apps/api/src/features/provider-accounting) | Persisted invocation/settlement contracts and ordered migrations | Native D1 repository and upgrade tests; passing unit tests alone do not prove SQL behavior |

## Choose the verification surface

Use the [local-development guide](../../how-to/local-development.md) for setup.
Root `package.json` and package scripts own executable commands.

| Changed risk | Existing command/surface |
| --- | --- |
| Docs or local instruction pointers | `pnpm docs:check` |
| Types, formatting and mechanical rules | `pnpm check`, `pnpm lint`, `pnpm format:check` |
| Pure/package or feature behavior | The affected package's `test` command and focused test files |
| Native D1, Durable Object and binding behavior | `pnpm --filter @meal-planner/worker-tests test`; relevant native integration fixtures |
| Website/API user behavior and account isolation | `pnpm --filter @meal-planner/web test:e2e`; Chromium and mobile WebKit journeys |
| Native stack composition | `pnpm test:stack` |
| Media execution and container lifecycle | `pnpm test:container` |
| Model/prompt quality | [Evaluation pack](../../../evals/private-discovery/README.md) and the accepted release policy; synthetic browser replies do not establish model quality |

Run the checks relevant to the claim, plus the required CI checks. Root `pnpm test`
includes ordinary and native Worker suites but not every browser, stack or container
surface above. Re-run when new changes, failures or unresolved concerns warrant it.
Update the owning row when boundaries or observable proof change. Keep detailed
domain rules in their existing canonical reference rather than copying them here.
