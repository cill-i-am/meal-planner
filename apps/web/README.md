# Recipe import web proof of concept

This independent TanStack Start workspace proves one path only: submit one public TikTok HTTPS URL, render the canonical import intent immediately, poll truthful processing stages, edit the recipe name when the generated review action permits it, confirm it, and show the saved canonical Recipe.

## Run locally

Run the recipe-import API and this web workspace with its runtime configuration:

```sh
RECIPE_IMPORT_API_BASE_URL=https://your-recipe-import-api.example \
RECIPE_IMPORT_DEFAULT_PROFILE_ALIAS=household-a \
RECIPE_IMPORT_PROFILE_A_ALIAS=household-a \
RECIPE_IMPORT_PROFILE_A_LABEL='Household A' \
RECIPE_IMPORT_PROFILE_A_TOKEN=your-household-a-server-credential \
RECIPE_IMPORT_PROFILE_B_ALIAS=household-b \
RECIPE_IMPORT_PROFILE_B_LABEL='Household B' \
RECIPE_IMPORT_PROFILE_B_TOKEN=your-household-b-server-credential \
pnpm --filter @meal-planner/web dev
```

The app composes the generated `RecipeImportApiClient` from `@meal-planner/recipe-import-api` inside a server-only module. Its Effect-managed server runtime decodes the required API base URL and closed server-only profile registry once when first acquired, retains each credential as `Redacted`, and selects the configured client from the browser-visible opaque alias. The server functions return only schema-encoded canonical data. The browser receives only each alias and label; it supplies neither an upstream URL/method/path/header nor a bearer token, actor ID, or household scope, and it contains no handwritten `fetch` client or copied API DTOs.

The selected alias is validated URL search state. Switching profiles clears the current intent view, stops the old profile session and polling, and keeps the profile alias first in every intent, action, and recipe query key. This proves row-level household isolation in one shared D1, not Durable Object tenancy. Better Auth is deliberately deferred; the app-local registry is the replaceable authentication seam for this POC.

## Deliberate limitations

- This is a single-intent proof: it does not provide a saved-recipe browser/listing, batch/run flow, general correction editor, authentication UI, realtime transport, or deployment-ready end-user authorization.
- Batch and provider-settlement routes remain system-principal-only and cannot be selected in this UI. Operator-carousel remains household-principal scoped and is outside this page.
- The current UI presents the generated review and offers one name editor only when the canonical action marks `name` editable. It submits that typed answer with the current action version; no arbitrary correction editor is implied.
- The web workspace makes no direct provider calls. Any TikTok/media/AI/provider work remains behind the canonical API, and this POC has no Tesco, basket, checkout, payment, publish, or external-message effects.
