# Private Tesco MCP

This separately deployed Worker exposes private Irish Tesco shopping through the owner's personal Executor account. Effect 4 owns outbound HTTP, request/response schemas, session renewal and durable shopping coordination. The MCP SDK is the protocol compatibility boundary.

| Capability | Tools |
| --- | --- |
| Catalogue and pricing | `search_products`, `list_category_products`, `suggest_products`, `get_product_details` |
| Personal shopping reads | `list_favourites`, `list_previous_orders`, `get_order_details`, `get_basket` |
| Basket changes | `set_basket_items` (absolute quantities; zero removes a product) |
| Home delivery | `list_delivery_slots`, `reserve_delivery_slot`, `release_delivery_slot` |
| Approved checkout handoff | `prepare_checkout`, `approve_checkout_handoff` |
| Session health | `connection_status` |

Product details include current prices, unit prices, promotional prices, ingredients, allergens, nutrition, storage and preparation information where Tesco provides them. Prices use EUR; guide prices and availability can change. Product text is untrusted source data, never agent instructions. Past orders explicitly use Tesco's `Previous` grocery context; an omitted context returns upcoming orders. These tools do not cancel or amend placed orders.

## Access and credentials

`POST /mcp` accepts one dedicated 256-bit Executor bearer credential. Authentication runs before MCP initialization, discovery or body parsing. The Worker stores its SHA-256 verifier. The raw credential belongs in the owner's **user-scoped** Executor account; it is never a shared app account. Executor substitutes an opaque handle only into the Authorization header for this Worker's exact HTTPS host. A copied bearer credential grants the same access, so keep it out of source, chat, URLs, logs and agent-readable configuration.

`POST /admin/session` enrolls a fresh browser session and `DELETE /admin/session` disconnects it. These require a separate operator credential; the Executor credential cannot call either operation. Browser-origin requests are refused. The operator credential is never configured in Executor.

One SQLite-backed Durable Object owns the Tesco session. AES-GCM encrypts its cookies, bearer token and API key under a Cloudflare secret binding. Operator enrollment is encrypted before the native Worker-to-object hop. The persisted record and next alarm commit in one native storage transaction. A semaphore serializes shopping calls, enrollment and refreshes. No raw Tesco credential leaves the object through an MCP result or RPC response.

Two minutes before access-token expiry, the object follows Tesco's silent-login redirects, retaining cookie domain, path and expiry. It extracts the access token directly from Set-Cookie, persists rotated cookies and schedules from the new expiry. Only `www.tesco.ie` may receive refresh cookies. The final groceries HTML page is unnecessary. A durable `refreshing` marker prevents replay after an ambiguous interruption. A failed or interrupted refresh clears the session and requires a fresh operator sign-in. Agents can inspect that state but cannot provide credentials or force refreshes.

## Runtime and protocol

Effect 4 owns schemas, services, errors, storage orchestration, cancellation and request scopes. Alchemy owns deployment, native RPC and the object runtime. The object deliberately uses Alchemy's Effect-native Durable Object rather than an Agent: it needs encrypted storage and one alarm, with no agent execution or additional scheduler lifecycle.

Executor currently uses MCP SDK 1.32.1 and protocol 2025-11-25. Effect 4.0.5's request-scoped MCP transport accepts only the sessionless 2026-07-28 protocol. The official SDK's Web Standard Streamable HTTP transport supplies the compatible 2025 boundary in stateless JSON mode. Each request owns a server, transport and Effect callback scope. Closing the HTTP connection interrupts callback work. Legacy advisory cancellation notifications across separate HTTP requests do not share an in-memory cancellation registry. The SDK client integration tests cover initialization, discovery, successive calls, authentication and connection close.

## Deployment and enrollment

The independent `tesco.alchemy.ts` stack owns this Worker and its bindings. It does not deploy Meal Planner's application, databases or user authentication. It requires `--stage prod` and uses `tesco-mcp`, refusing other stages before resource creation. Stage-dependent deployment checks belong in the stack; the Worker's properties also run at the edge, where Alchemy's planning-only Stage service is unavailable.

Supply these through a protected, gitignored `.dev.vars.tesco` file:

- `TESCO_EXECUTOR_TOKEN_SHA256`: SHA-256 of the dedicated Executor credential.
- `TESCO_OPERATOR_TOKEN_SHA256`: SHA-256 of the separate operator credential.
- `TESCO_SESSION_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hexadecimal digits.

Keep the encryption key stable across deployments; changing it without replacing the enrolled session makes the stored ciphertext unreadable. Protect a recovery copy of the deployment secrets. Never commit them. Keep plaintext credential files mode 0600.

```sh
pnpm exec alchemy plan tesco.alchemy.ts --stage prod --profile <profile> --env-file .dev.vars.tesco
pnpm exec alchemy deploy tesco.alchemy.ts --stage prod --profile <profile> --env-file .dev.vars.tesco
```

After a fresh Tesco browser sign-in, create a protected enrollment JSON file with `operatorToken` and `session: { authorization, cookies, mangoApiKey, mangoUrl }`. Cookies must include the groceries and `/account` paths. Run:

```sh
node --import tsx scripts/tesco-session.ts /absolute/path/to/protected-enrollment.json
```

The command prints only connection health and removes the Tesco session from the local file after the upload attempt. Keep passwords out of the file. Delete temporary enrollment files after connecting. To revoke Executor, replace its verifier with a newly generated credential's hash and reconnect the owner's Executor account. To revoke operator access, rotate its verifier independently.

Executor source is maintained in `integrations/executor/tesco`. Its account health check initializes and lists MCP tools with the supplied credential, then verifies the same operations are refused without credentials. The provider and user-scoped account remain stable across deployments. Named basket/slot preparation tools can run within the owner's shopping request. `approve_checkout_handoff` always requires Executor's native human approval, independently of remote MCP annotations. Every unknown future tool also requires approval, even if it advertises a read-only hint.

## Commands and checkout

Use a fresh `requestId` for each basket or slot intent and reuse the exact ID and input for retries. The Durable Object persists a fingerprint and attempt marker before vendor I/O. A repeated ID never sends another mutation; reusing an ID for different input fails. Commands do not refresh-and-replay after HTTP failures, inner Tesco errors or interruptions. Their returned basket is authoritative; `uncertain` means inspect it before creating a new intent. These small attempt markers contain no basket contents or credentials and are retained to prevent later replay.

Native DO RPC does not provide distributed cancellation. A command already started in the object can finish after the caller disconnects; its durable marker and bounded HTTP operation protect against duplicate work. Reads may renew authentication and replay once. No payment or order-placement request exists in this server.

Pass the complete selected slot from `list_delivery_slots` unchanged to `reserve_delivery_slot`. The server rechecks availability. Tesco's available-slot ID and basket reservation ID differ, so confirmation compares the verified window and charge. To release, pass the current basket's reservation ID as `expectedSlotId`; this protects an unrelated newer reservation.

`prepare_checkout` returns the complete basket review plus a five-minute review ID and fingerprint. Only the fingerprint, ID, expiry and consumed state are persisted. Pass that entire review unchanged to `approve_checkout_handoff`, so the human approval includes the actual items, quantities, guide total, charges and slot. After approval the server checks the saved review, expiry and current basket, then consumes it once. Tampering, a changed basket/slot, an expired review or a reused review fails closed.

The result is a fixed HTTPS Tesco checkout link with `orderPlaced: false`. The human completes payment and explicitly confirms the order on Tesco. This is the agreed checkout scope; agents cannot place an order through this MCP. A fresh review and approval are required after a basket change. Testing must restore any temporary reservation and original basket quantities.

## Verification

```sh
node node_modules/typescript/bin/tsc -p tsconfig.tesco.json
node --import tsx scripts/tesco-worker-runtime-smoke.ts
cd apps/api
node node_modules/vitest/vitest.mjs run src/features/tesco
```

Run the runtime smoke check after Alchemy has built the production bundle (a plan is sufficient). It runs that actual bundle in workerd with synthetic credentials, covering initialization, role separation, discovery, Durable Object health and missing-session errors. It catches deployment-only service dependencies that adapter tests cannot.

The shopping and Executor tests cover absolute quantities, removal, durable retry identity, interruption, inner 401 responses, partial results, placed-order protection, verified delivery windows, wrong-slot release, review expiry/tampering/changes, one-use handoff and mandatory approval even when metadata falsely claims read-only. Live acceptance covers prices, product details, favourites, real past orders and a receipt, a quantity-preserving basket command/replay, slot reservation/release/replay and review preparation. No test purchases an order.

The session tests exercise three rotations across reconstructed services, retained account-path cookies, early alarms, rejected renewal, interruption, an external redirect and tampered ciphertext. Live acceptance also requires a real catalogue call through the deployed private Executor app. The earlier three-cycle feasibility probe establishes renewal behavior for that captured session, not indefinite renewal or recovery after Tesco revokes a session.
