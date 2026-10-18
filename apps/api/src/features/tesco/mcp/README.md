# Private Tesco MCP

This separately deployed Worker exposes the existing Irish Tesco catalogue through `search_products`, `list_category_products`, `suggest_products` and `connection_status`. Every tool is read-only. It has no basket or checkout tools.

## Access and credentials

`POST /mcp` accepts one dedicated 256-bit Executor bearer credential. Authentication runs before MCP initialization, discovery or body parsing. The Worker stores its SHA-256 verifier. The raw credential belongs in the owner's **user-scoped** Executor account; it is never a shared app account. Executor substitutes an opaque handle only into the Authorization header for this Worker's exact HTTPS host. A copied bearer credential grants the same access, so keep it out of source, chat, URLs, logs and agent-readable configuration.

`POST /admin/session` enrolls a fresh browser session and `DELETE /admin/session` disconnects it. These require a separate operator credential; the Executor credential cannot call either operation. Browser-origin requests are refused. The operator credential is never configured in Executor.

One SQLite-backed Durable Object owns the Tesco session. AES-GCM encrypts its cookies, bearer token and API key under a Cloudflare secret binding. Operator enrollment is encrypted before the native Worker-to-object hop. The persisted record and next alarm commit in one native storage transaction. A semaphore serializes catalogue calls, enrollment and refreshes. No raw Tesco credential leaves the object through an MCP result or RPC response.

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

Executor source is maintained in `integrations/executor/tesco`. Its account health check initializes and lists MCP tools with the supplied credential, then verifies the same operations are refused without credentials. All future upstream tools without an explicit read-only hint require approval in Executor.

## Verification

```sh
node node_modules/typescript/bin/tsc -p tsconfig.tesco.json
node --import tsx scripts/tesco-worker-runtime-smoke.ts
cd apps/api
node node_modules/vitest/vitest.mjs run src/features/tesco
```

Run the runtime smoke check after Alchemy has built the production bundle (a plan is sufficient). It runs that actual bundle in workerd with synthetic credentials, covering initialization, role separation, discovery, Durable Object health and missing-session errors. It catches deployment-only service dependencies that adapter tests cannot.

The session tests exercise three rotations across reconstructed services, retained account-path cookies, early alarms, rejected renewal, interruption, an external redirect and tampered ciphertext. Live acceptance also requires a real catalogue call through the deployed private Executor app. The earlier three-cycle feasibility probe establishes renewal behavior for that captured session, not indefinite renewal or recovery after Tesco revokes a session.
