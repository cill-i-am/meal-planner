# Boundaries and Parsing

Parse data when it enters the application from a request, storage, a framework or another runtime. Pass the parsed value to the code that uses it. When sending data out, explicitly build the shape the recipient needs.

## Vocabulary

**Unknown Boundary Input** — Data from HTTP, RPC, queues, env vars, storage rows, JSON, third-party APIs, runtime hops, or framework objects before a parser establishes a precise type.

**External Adapter Module** — The module that translates between external/framework representations and service/domain values. It includes inbound protocol handlers and outbound persistence, runtime, SDK, platform, and third-party adapters.

**Persistence Boundary Parser** — A parser that reconstructs domain values from storage DTOs or rows and rejects contradictory persisted state.

**Protocol Projection** — A conversion from domain/service value to HTTP/RPC/queue/public API shape, owned by the protocol External Adapter Module.

**Persistence Projection** — A conversion between domain/service values and storage rows/records, owned by the persistence External Adapter Module.

## Non-negotiables

- Keep incoming data as `unknown` or a data-transfer object (DTO) until it has been parsed.
- The External Adapter Module, handler, composition entrypoint or receiving runtime handler parses external input before passing it to service or core code. Pass the resulting valid value, not the original input.
- Decoded JSON, response bodies, env values, queue messages, storage JSON, and similar data are not cast into domain/service types.
- A successful parse returns the refined value; do not validate and then keep passing the unrefined input.
- Service and core code must not repeatedly cast, inspect or revalidate a parsed value unless it has crossed another boundary.
- Storage/ORM rows are boundary input and are parsed before service logic sees them.
- Runtime-hop payloads satisfy the transport serialization contract and are parsed/reconstructed on receipt.
- Protocol DTOs and persistence records are different projections; do not reuse one as the other by convenience.
- Environment/runtime config is parsed at startup or the earliest composition seam into typed config.

## Strong defaults

- Use the repository's established schema library when it satisfies the contract.
- In Effect codebases, use Effect Schema for refined values and codecs.
- Generic schema helpers should be Standard Schema compatible.
- If no schema convention exists outside Effect, prefer Zod 4.
- Mutating command/request object parsers reject unknown fields by default.
- Concrete parsers are named `parseX`.
- Smart constructors from already typed pieces are named `makeX` or `createX`.
- True predicates are named `isX`.
- Avoid `validateX` for functions that return refined values; they parse.

## Parse early

Follow the repository's error-handling convention for parse failures. A parser may return a `Result`, use the established typed failure channel, or throw within a schema adapter that immediately classifies the error. On success, pass the parsed value to Service Modules and Domain Modules.

Prefer:

```ts
async function handle(
  body: unknown
): Promise<Result<Response, CreateUserError>> {
  const input = CreateUserInput.parse(body);
  if (input._tag === "err") {
    return input;
  }

  return users.create(input.value);
}
```

Avoid:

```ts
async function handle(body: any) {
  return users.create(body); // untrusted data enters service logic
}
```

Do not validate a value and then pass the unparsed input:

```ts
CreateUserSchema.parse(body);
return users.create(body); // still the unrefined value
```

## No serialized trust casts

Avoid:

```ts
const input = JSON.parse(text) as CreateUserInput;
const user = (await response.json()) as User;
const row = record as Invoice;
```

Prefer:

```ts
const raw: unknown = JSON.parse(text);
const input = CreateUserInput.parse(raw);
```

A cast after parsing can be acceptable for branding internals when TypeScript cannot express the invariant, but it needs a local `SAFETY:` explanation and must not leak to callers.

## Concrete parsers, not shared shape guards

Do not export generic utilities like:

```ts
isRecord(value): value is Record<string, unknown>;
isObject(value): value is object;
isArray(value): value is unknown[];
```

They usually mean untrusted values are flowing too far inward. Use concrete parsers:

```ts
const input = CreateUserInput.parse(body);
```

Local `Array.isArray` or object checks are fine inside concrete parser/schema-adapter implementations.

## Strict command objects

Mutating command/request parsers should reject unknown fields so misspellings and obsolete fields fail loudly:

```ts
const CreateUserBody = z.strictObject({
  email: EmailAddressSchema,
  role: RoleSchema,
});
```

Use permissive shapes only for explicitly extensible sub-objects, such as third-party metadata.

## Persistence boundary parsing

An inferred database row type describes the columns. It does not prove that the row is a valid domain value:

```ts
type InvoiceRow = typeof invoices.$inferSelect;

function parseInvoiceRow(
  row: InvoiceRow
): Result<Invoice, InvalidStoredInvoice> {
  // reject impossible combinations; reconstruct domain values
}
```

Reject contradictory persisted states. Do not silently normalize an impossible row such as `state = "open"` with a non-null `completedAt`.

Use schema-inferred row/insert/update DTOs where the storage library supports them, but parse rows before service logic sees them.

## Runtime and serialization boundaries

Values crossing process, runtime, RPC, queue, workflow, Worker/DO/Agent, or structured-clone boundaries must be serializable for that transport.

Do not send rich local objects unless the transport explicitly preserves them:

- class instances;
- custom errors;
- value classes;
- functions;
- database handles;
- request-local objects;
- prototypes/private state.

Use explicit DTOs/codecs and parse on the receiving side:

```txt
Domain value -> protocol DTO -> runtime hop -> parse DTO -> local domain value
```

This applies to result and error values too.

## Protocol and persistence projections

Keep each conversion with the adapter that sends or stores the data:

```ts
UserHttp.toPublicJson(user);
UserStorage.toRow(user);
UserQueue.encodeUserCreated(event);
```

Avoid Domain Modules exporting HTTP response policy or persistence column shapes. Domain Modules may expose neutral deconstruction/accessor helpers and domain formatting, but External Adapter Modules own their consumer-specific protocol and persistence shapes.

Do not reuse an HTTP JSON response as a database row merely because both are serializable.

## Config parsing

Parse environment/runtime config once at startup or composition:

```ts
type AppConfig = {
  readonly databaseUrl: Url;
  readonly apiToken: Redacted<string>;
};
```

Avoid reading `process.env` or platform env bindings throughout the app. Missing or invalid required config is a startup defect. Report enough safe detail to diagnose it without exposing secrets.

## Rejected framings

- **"TypeScript says the row is typed."** Storage types describe database shape, not domain validity.
- **"JSON.parse as T is fine inside a trusted system."** Serialized data loses runtime proof.
- **"We validated it already."** If the refined value is not what flows inward, the parse did not help.
- **"DTOs are domain models."** DTOs are boundary representations.
- **"Generic isRecord helpers are harmless."** They usually spread boundary uncertainty inward.

## Review checklist

Check the relevant items below when reviewing a change. The sections above explain the rules.

- Typing request bodies as `any` for convenience.
- Casting `Response.json()` output to an app type.
- Passing Drizzle/ORM rows directly to Service Modules.
- Reusing public API JSON as persistence records.
- Accepting unknown fields in mutating commands by default.
- Parsing config in many modules instead of one composition seam.
- Sending custom error/class instances across runtime boundaries without codecs.
