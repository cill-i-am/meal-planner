# Recipe Imports

This private workspace owns recipe source resolution, media acquisition and the evidence contracts supplied to speech and visual providers. Its first source adapter is TikTok. Nothing here exposes a public endpoint.

- **Sources:** turn a submitted URL into a bounded media source.
- **Media:** acquire, validate, and stage generation-scoped artifacts. The existing Alchemy stack still creates the container, acquisition object and bucket; no resources are renamed.
- **Evidence:** describe inputs, normalized transcripts and observations without exposing provider credentials or raw artifacts to the calling agent.

The Meal Planner API still authenticates and dispatches import intents. Household owns import state, admission, retry fences and draft acceptance. The provider call, accounting and checkpoint journal stay together in the import workflow host. Consumers import only declared workspace subpaths; this workspace does not depend on the API.

Run `pnpm --filter @meal-planner/recipe-imports test` for the local processing suite. The native workflow, household approval and real container suites continue to run from the API test harness.
