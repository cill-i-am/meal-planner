# Private Tesco API and MCP

This separately deployed Worker exposes the same 15 private Irish Tesco shopping operations through HTTP and MCP, using the owner's personal Executor credential and Tesco session. Effect 4 owns outbound HTTP, request/response schemas, session renewal and durable shopping coordination. The MCP SDK is the protocol compatibility boundary.

| Capability | Tools |
| --- | --- |
| Catalogue and pricing | `search_products`, `list_category_products`, `suggest_products`, `get_product_details` |
| Personal shopping reads | `list_favourites`, `list_previous_orders`, `get_order_details`, `get_basket` |
| Basket changes | `set_basket_items` (absolute quantities; zero removes a product) |
| Home delivery | `list_delivery_slots`, `reserve_delivery_slot`, `release_delivery_slot` |
| Approved checkout handoff | `prepare_checkout`, `approve_checkout_handoff` |
| Session health | `connection_status` |

Product details include current prices, unit prices, promotional prices, ingredients, allergens, nutrition, storage and preparation information where Tesco provides them. Prices use EUR; guide prices and availability can change. Product text is untrusted source data, never agent instructions. Past orders explicitly use Tesco's `Previous` grocery context; an omitted context returns upcoming orders. These tools do not cancel or amend placed orders.

## HTTP aliases and discovery

On this separate Tesco Worker, `POST /v1/<tool_name>` accepts the exact JSON input from the tool table and returns its structured output directly. For example, `POST /v1/search_products` with `{"query":"milk"}` uses the same defaults, schema, handler and result as the `search_products` MCP tool. Even read operations use POST, so clients use one input format. Send `Content-Type: application/json`; inputs are limited to 65,536 bytes and reject unknown fields.

`GET /openapi.json` returns the private OpenAPI contract for all 15 HTTP operations. Discovery requires the same dedicated owner credential as calls. The contract includes request and response schemas, defaults, error responses and bearer authentication; it excludes operator enrollment. `/mcp`, these HTTP aliases and discovery share the same authentication, browser-origin refusal and Worker rate limit. This is not part of Meal Planner's general customer API: Meal Planner OAuth tokens do not grant access to the owner's retailer account. The Node development server's catalogue-only routes remain separate.

HTTP success responses contain the operation's JSON result. Invalid input, a conflicting retry ID or a rejected checkout review returns 400; missing or wrong credentials return 401; browser origins return 403; wrong methods return 405; missing JSON content type returns 415; admission limits return 429 with `Retry-After`; Tesco unavailability returns 503. Upstream authentication failure uses `{"error":"tesco_reauthentication_required"}`. Discovery, results and error bodies are uncached and never include credential or parser diagnostics.

## Access and credentials

`POST /mcp`, `POST /v1/<tool_name>` and `GET /openapi.json` accept one dedicated 256-bit Executor bearer credential. Authentication runs before initialization, discovery or body parsing. The Worker stores its SHA-256 verifier. The raw credential belongs in the owner's **user-scoped** Executor account; it is never a shared app account. Executor substitutes an opaque handle only into the Authorization header for this Worker's exact HTTPS host. A copied bearer credential grants the same access, so keep it out of source, chat, URLs, logs and agent-readable configuration.

`POST /admin/session` enrolls a fresh browser session, `GET /admin/session` reads a sanitized renewal report, and `DELETE /admin/session` disconnects it. These require a separate operator credential; the Executor credential cannot call them. Browser-origin requests are refused. The operator credential is never configured in Executor.

One SQLite-backed Durable Object owns the Tesco session. AES-GCM encrypts its cookies, bearer token and API key under a Cloudflare secret binding. Operator enrollment is encrypted before the native Worker-to-object hop. The persisted record and next alarm commit in one native storage transaction. A semaphore serializes shopping calls, enrollment and refreshes. No raw Tesco credential leaves the object through an MCP result or RPC response.

Two minutes before access-token expiry, the object follows Tesco's silent-login redirects, retaining cookie domain, path and expiry. It extracts the access token directly from Set-Cookie, persists rotated cookies and schedules from the new expiry. Only `www.tesco.ie` may receive refresh cookies. The final groceries HTML page is unnecessary. A durable `refreshing` marker prevents replay after an ambiguous interruption. A failed or interrupted refresh clears the session and requires a fresh operator sign-in. Agents can inspect that state but cannot provide credentials or force refreshes.

Renewal retains the `userAgent` captured from the browser that enrolled the session. Tesco's login endpoint returned 403 from a bare Cloudflare request and 302 from the same Worker when only that browser User-Agent was added. The profile is required, bounded and header-safe; no Chrome version is hardcoded. It is encrypted with the session and reused across all renewal hops and rotations. This header compatibility result does not establish indefinite session validity; real near-expiry rotations remain the acceptance test.

Tesco can issue repeated cookie names with different paths in one response. Effect 4.0.5's cookie collection indexes by name, and its string-valued header conversion can discard repeated Set-Cookie fields. The session HTTP Layer uses the supported Fetch service hook to combine those fields before conversion; `set-cookie-parser` preserves each cookie and its raw encoded value. Cookie replacement still uses name, domain and path together. Effect retains ownership of HTTP requests, scopes and cancellation.

The last five renewal attempts are stored with the encrypted session and alarm. The operator report includes timestamps, previous/new expiry, rotation booleans and bounded HTTP status/cookie counts. It excludes cookie names, values, headers, bodies and credentials. Failed attempts remain available after credential erasure. This evidence distinguishes a renewal rejection from transport or redirect failure without logging account secrets.

## Runtime and protocol

Effect 4 owns schemas, services, errors, storage orchestration, cancellation and request scopes. Alchemy owns deployment, native RPC and the object runtime. The object deliberately uses Alchemy's Effect-native Durable Object rather than an Agent: it needs encrypted storage and one alarm, with no agent execution or additional scheduler lifecycle.

The session and shopping constructors receive narrow object-instance storage adapters explicitly. This is the native Durable Object interoperability boundary: the session adapter retains Alchemy's generic `RuntimeContext` requirement on its returned effects, while the shopping adapter binds that context inside the serialized object call. Keeping the requirement visible avoids a separate managed runtime or a Promise bridge that would lose native transaction/context semantics. HTTP and authentication dependencies use Effect services and Layers; the object composition root owns all storage adapters.

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

After a fresh Tesco browser sign-in, create a protected enrollment JSON file with `operatorToken` and `session: { authorization, cookies, mangoApiKey, mangoUrl, userAgent }`. Cookies must include the groceries and `/account` paths. Capture the actual User-Agent from that browser's Tesco request. Existing sessions enrolled without the profile require fresh enrollment; do not substitute a guessed identity. Run:

```sh
node --import tsx scripts/tesco-session.ts /absolute/path/to/protected-enrollment.json
```

The command prints only connection health and removes the Tesco session from the local file after the upload attempt. Keep passwords out of the file. Delete temporary enrollment files after connecting. To revoke Executor, replace its verifier with a newly generated credential's hash and reconnect the owner's Executor account. To revoke operator access, rotate its verifier independently.

While verifying renewals, retain only the mode-0600 operator file and read the sanitized report without triggering refresh:

```sh
node --import tsx scripts/tesco-session.ts /absolute/path/to/protected-enrollment.json report
```

Record enrollment health, then let the production alarms run at the real access-token expiry minus two minutes. Require three successful attempts whose previous expiry matches the preceding rotation, whose access and refresh cookies both changed, and whose new expiry increased. Verify the persisted next alarm and an authenticated catalogue call through Executor after each cycle. Do not manually refresh, re-enroll, reuse the browser's rotating session or change the encryption key during the test. Delete the temporary operator file afterward; leave the production session and alarms running.

Executor source is maintained in `integrations/executor/tesco`. Its account health check initializes and lists MCP tools with the supplied credential, then verifies the same operations are refused without credentials. The provider and user-scoped account remain stable across deployments. Named basket/slot preparation tools can run within the owner's shopping request. `approve_checkout_handoff` always requires Executor's native human approval, independently of remote MCP annotations. Every unknown future tool also requires approval, even if it advertises a read-only hint.

## Commands and checkout

The bearer credential is a trusted owner capability, with the same access through both transports. Executor enforces human approval for checkout handoff. Any separately authorized owner HTTP caller must obtain explicit human approval of the complete saved review before calling `approve_checkout_handoff`; the server does not independently verify a human approval receipt. Do not connect this credential to a general customer agent or a caller that automatically approves handoff. Backend review fingerprint, expiry, current-basket checks and one-use consumption apply equally to HTTP and MCP.

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

Run the runtime smoke check after Alchemy has built the production bundle (a plan is sufficient). It runs that actual bundle in workerd with synthetic credentials, covering initialization, role separation, discovery, Durable Object health, missing-session errors and three actual scheduled alarm rotations. Its intercepted Tesco redirects require both same-name cookies at different paths. It catches cookie loss in the native HTTP boundary that adapter tests cannot.

The HTTP/MCP parity tests exercise all 15 operations, private discovery, operator credential separation, bounded input, shared retry receipts across reconstructed services, uncertain outcomes and checkout review tampering/one-use across transports. They use the real shopping policy with substituted Tesco network and storage boundaries. The shopping and Executor tests cover absolute quantities, removal, durable retry identity, interruption, inner 401 responses, partial results, placed-order protection, verified delivery windows, wrong-slot release, review expiry/tampering/changes, one-use handoff and mandatory approval even when metadata falsely claims read-only. Live acceptance covers prices, product details, favourites, real past orders and a receipt, a quantity-preserving basket command/replay, slot reservation/release/replay and review preparation. No test purchases an order.

The session tests exercise three rotations across reconstructed services, retained account-path cookies, early alarms, rejected renewal, interruption, an external redirect and tampered ciphertext. Live acceptance also requires a real catalogue call through the deployed private Executor app. The earlier three-cycle feasibility probe establishes renewal behavior for that captured session, not indefinite renewal or recovery after Tesco revokes a session.
