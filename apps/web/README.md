# Meal Planner website

This TanStack Start website provides same-origin email/password authentication, session and household organization setup, and the recipe-import flow. Better Auth owns identity and organization membership. The browser never receives a bearer token or selects a synthetic profile.

## Runtime boundary

The public Website Worker forwards `/api/auth/*` and `/v1/*` to the private API Worker through a Cloudflare service binding. It forwards the original `Request` and returns the upstream `Response`, preserving `Cookie` and `Set-Cookie` without copying credentials into application code.

The API mounts Better Auth at `/api/auth/*`. Application routes resolve the Better Auth session and verify the selected organization against the `member` table before constructing the typed Effect principal. An `activeOrganizationId` cookie value alone is never authorization.

## Database lifecycle

Better Auth uses its own Cloudflare D1 database through the official Drizzle adapter. Generate the schema from the actual auth configuration with `pnpm auth:schema:generate`, then generate checked-in SQLite migrations with `pnpm auth:db:generate`. Drizzle Kit is the only schema migration owner; Alchemy provisions and binds D1 and applies those checked-in migrations.

## Deliberate limitations

- This slice supports email/password rather than username/password because Better Auth's native credential flow is email-based.
- The household storage tracer uses the selected Better Auth organization ID only after API-side membership authorization; the browser cannot select a Durable Object directly.
- It remains a single-intent recipe-import experience without a saved-recipe browser/listing, batch/run UI, general correction editor, or realtime transport.
- Batch and provider-settlement routes remain system-principal-only and cannot be selected in this UI. Operator-carousel remains household-principal scoped and is outside this page.
- The current UI presents the generated review and offers name and planning-tag editors when the canonical action marks those fields editable. It submits each typed answer with the current action version; no arbitrary correction editor is implied.
- The web workspace makes no direct provider calls. Any TikTok/media/AI/provider work remains behind the canonical API, and this interface has no Tesco, basket, checkout, payment, publish, or external-message effects.
