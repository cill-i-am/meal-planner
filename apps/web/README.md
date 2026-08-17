# Recipe import web proof of concept

This independent TanStack Start workspace proves one path only: submit one public TikTok HTTPS URL, render the canonical import intent immediately, poll truthful processing stages, edit the recipe name when the generated review action permits it, confirm it, and show the saved canonical Recipe.

## Run locally

Run the recipe-import API and this web workspace with its runtime configuration:

```sh
RECIPE_IMPORT_API_BASE_URL=https://your-recipe-import-api.example \
RECIPE_IMPORT_API_TOKEN=your-server-credential \
pnpm --filter @meal-planner/web dev
```

The app composes the generated `RecipeImportApiClient` from `@meal-planner/recipe-import-api` inside a server-only module. Its Effect-managed server runtime decodes the required API base URL and bearer credential once when first acquired, retains the credential as `Redacted`, and reuses the configured client for subsequent server-function calls. The server functions return only schema-encoded canonical data. The browser supplies neither an upstream URL/method/path/header nor a credential, and it contains no handwritten `fetch` client or copied API DTOs.

## Deliberate limitations

- This is a single-intent proof: it does not provide a saved-recipe browser/listing, batch/run flow, correction editor, authentication UI, realtime transport, or deployment-ready end-user authorization.
- The current UI presents the generated review and offers one name editor only when the canonical action marks `name` editable. It submits that typed answer with the current action version; no arbitrary correction editor is implied.
- The web workspace makes no direct provider calls. Any TikTok/media/AI/provider work remains behind the canonical API, and this POC has no Tesco, basket, checkout, payment, publish, or external-message effects.
