# Recipe import web proof of concept

This independent TanStack Start workspace proves one path only: submit one public TikTok HTTPS URL, poll truthful processing stages, review one projected draft, approve it, and show the one matching Recipe Bank result.

## Run locally

Use two processes from the repository root:

```sh
pnpm --filter @meal-planner/web fake-api
RECIPE_IMPORT_API_BASE_URL=http://127.0.0.1:4311 RECIPE_IMPORT_API_TOKEN=poc-local-bearer-token pnpm --filter @meal-planner/web dev
```

The API token is read only inside TanStack Start server-function handlers. The BFF accepts no upstream URL, method, path, header, or token from the browser, and the API base rejects anything except loopback HTTP.

## Deliberate limitations

- Current-main Node development does not mount the production import/review routes, so this proof uses a separate deterministic localhost HTTP fake with production-shaped endpoints.
- Fresh production reviews currently have no tags-only approval path. The fake returns a review with valid planning tags so the existing approval shape can succeed; this slice does not change the backend.
- This app is unsupported for deployment until a real user access/authentication boundary exists. The fixed local bearer token is not an end-user authorization design.
- There are no live TikTok, AI, Cloudflare, Tesco, basket, checkout, payment, publish, or external-message effects.
