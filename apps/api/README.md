# Meal Planner API

Effect v4 API with a private Cloudflare Worker for household meal planning and recipe imports, plus a Node host for read-only Tesco catalogue calls.

## Cloudflare Worker

`src/worker.ts` composes Better Auth, household membership and meal-plan routes, recipe imports, provider accounting and recovery, and `/health`. The Website reaches this private Worker through a service binding; browser requests stay same-origin.

`src/worker-entry.ts` exports the native conversation Durable Object beside the Worker declaration. The pinned Alchemy build explicitly retains that native export alongside its Effect exports. Source-file URLs resolve only during planning. The API captures its Alchemy binding context during construction and supplies it to request effects; the bridge supplies the request scope and execution context separately.

Household state lives in the household Durable Object. Global D1 stores Better Auth and provider accounting. Alchemy owns infrastructure; Drizzle Kit owns database schemas and migrations.

See [the infrastructure guide](../../docs/how-to/operate-infrastructure.md) for bindings, configuration, local runtime proof, and deployment boundaries. [The recipe-import architecture](../../docs/reference/recipe-import.md) describes import authority and processing.

## Local Tesco catalogue host

Use `pnpm dev:tesco` from the repository root for this focused host. See [local development](../../docs/how-to/local-development.md) for the full application runtime. The Node host reads shell environment through Effect Config; it does not load `.env` files.

Routes:

- `GET /health`
- `GET /tesco/search?query=milk&page=1&count=24&sortBy=relevance`
- `POST /tesco/search`
- `GET /tesco/categories/:facet/products?page=1&count=24&sortBy=relevance`
- `POST /tesco/categories/:facet/products`
- `GET /tesco/suggestions?query=milk&limit=10`

The Tesco facade accepts only these named catalogue reads, not caller-supplied GraphQL documents. It refreshes expiring authorization through Tesco soft login and retries a classified read once after a `401`.

Required environment:

- `HOST`, `PORT`
- `TESCO_MANGO_URL`, `TESCO_SUGGESTION_URL`
- `TESCO_LOCALE`, `TESCO_REGION`
- `TESCO_MANGO_API_KEY`, `TESCO_AUTHORIZATION`, `TESCO_AUTH_COOKIE_HEADER`
- `TESCO_SOFT_REFRESH_SIGN_IN_URL`, `TESCO_AUTH_REFRESH_FROM_URL`

Optional headers: `TESCO_TRANSACTION_PURPOSE`, `TESCO_RELEASE_BRANCH`.

## Source layout and verification

- `src/features/`: auth, households, meal planning, recipe imports, provider accounting, and Tesco slices.
- `src/app/`: Node composition, config, and shared HTTP handling.
- `src/infrastructure/`: Alchemy resources and request cancellation.
- `src/worker.ts`: Cloudflare composition; `src/main.ts`: Node entrypoint.

Use the root `pnpm check`, `pnpm test`, and `pnpm build` commands. For focused API verification, use `pnpm --filter @meal-planner/api check` or `pnpm --filter @meal-planner/api test`. The API package command runs Node and Workflow suites. Native `*.worker.test.ts` files run separately with `pnpm --filter @meal-planner/worker-tests test`; the root recursive test command includes both. See [local verification](../../docs/how-to/local-development.md#verification) for runtime coverage.
