import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { z } from "zod";

import type {
  CloudflareAuthConfig,
  CloudflareResolvedCredentials,
} from "../node_modules/alchemy/lib/Cloudflare/Auth/AuthProvider.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
const identifier = z.string().regex(/^[\w-]+$/u);
const account = z.string().regex(/^[a-f0-9]{32}$/u);
const database = z.strictObject({ name: identifier, uuid: z.uuid() });
const targetSchema = z.strictObject({
  accountId: account,
  databases: z.strictObject({
    MealPlannerAuthDatabase: database,
    ProviderAccountingDatabase: database,
  }),
  profile: identifier,
  stage: identifier,
  worker: identifier,
});

export type D1Target = z.infer<typeof targetSchema>;
type Resource = keyof D1Target["databases"];
const migrationDirectories = {
  MealPlannerAuthDatabase: "apps/api/auth-migrations",
  ProviderAccountingDatabase: "apps/api/provider-accounting-migrations",
} as const;
const resources = [
  "MealPlannerAuthDatabase",
  "ProviderAccountingDatabase",
] as const;
const sqlQueries = {
  alchemy:
    "SELECT id, name, hash, created_at, applied_at FROM d1_migrations ORDER BY id",
  columns: "PRAGMA table_info(d1_migrations)",
  legacy: "SELECT id, name, applied_at FROM d1_migrations ORDER BY id",
  schema:
    "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
} as const;

/** Only these fixed ledger reads may be sent to the D1 query endpoint. */
type LedgerQuery = (typeof sqlQueries)[keyof typeof sqlQueries];
export interface D1Reader {
  readonly accountId: string;
  readonly read: (path: string, sql?: LedgerQuery) => Promise<unknown>;
  readonly readState: (stage: string) => Promise<readonly unknown[]>;
}

export interface LocalMigration {
  readonly name: string;
  readonly hash: string;
}

interface Release {
  readonly head: string;
  readonly local: Readonly<Record<Resource, readonly LocalMigration[]>>;
  readonly toolchain: { readonly alchemy: string; readonly node: string };
}

const decode = <T>(
  schema: z.ZodType<T>,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- Decode untrusted JSON without exposing remote values.
  value: unknown,
  context: string
): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    // Schema errors can include remote/private values; expose only the boundary.
    throw new Error(`Invalid ${context}`);
  }
  return parsed.data;
};

// eslint-disable-next-line anti-slop/no-unknown-parameters -- Target files are untrusted JSON and are decoded immediately.
export const parseD1Target = (value: unknown): D1Target => {
  const target = decode(targetSchema, value, "D1 target");
  if (
    target.databases.MealPlannerAuthDatabase.uuid ===
    target.databases.ProviderAccountingDatabase.uuid
  ) {
    throw new Error("D1 target requires two distinct database UUIDs");
  }
  return target;
};

const settingsSchema = z.object({
  bindings: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      type: z.string(),
    })
  ),
  tags: z.array(z.string()),
});

const readWorkerTarget = async (
  reader: D1Reader,
  profile: string,
  worker: string
): Promise<D1Target> => {
  const settings = decode(
    settingsSchema,
    await reader.read(
      `/workers/scripts/${encodeURIComponent(worker)}/settings`
    ),
    "Worker settings"
  );
  const stages = settings.tags.filter((tag) =>
    tag.startsWith("alchemy:stage:")
  );
  const stacks = settings.tags.filter((tag) =>
    tag.startsWith("alchemy:stack:")
  );
  const ids = settings.tags.filter((tag) => tag.startsWith("alchemy:id:"));
  if (
    stages.length !== 1 ||
    stacks.length !== 1 ||
    stacks[0] !== "alchemy:stack:MealPlanner" ||
    ids.length !== 1 ||
    ids[0] !== "alchemy:id:MealPlannerApi"
  ) {
    throw new Error(
      "Worker ownership tags do not identify one MealPlanner API stage"
    );
  }
  const databases = Object.fromEntries(
    await Promise.all(
      resources.map(async (resource) => {
        const bindings = settings.bindings.filter(
          (binding) => binding.name === resource
        );
        const [binding] = bindings;
        if (
          bindings.length !== 1 ||
          binding?.type !== "d1" ||
          binding.id === undefined
        ) {
          throw new Error(`Worker must bind exactly one D1 for ${resource}`);
        }
        const uuid = decode(z.uuid(), binding.id, `${resource} binding UUID`);
        const metadata = decode(
          z.object(database.shape),
          await reader.read(`/d1/database/${uuid}`),
          `${resource} metadata`
        );
        if (metadata.uuid !== uuid) {
          throw new Error(`${resource} metadata UUID differs from its binding`);
        }
        return [resource, metadata] as const;
      })
    )
  );
  return parseD1Target({
    accountId: reader.accountId,
    databases,
    profile,
    stage: stages[0]?.slice("alchemy:stage:".length),
    worker,
  });
};

/** Inventory does not inspect ledgers or select an ambiguous stage. */
export const discoverD1Targets = async (
  reader: D1Reader,
  profile: string
): Promise<readonly D1Target[]> => {
  const workers = decode(
    z.array(z.object({ id: identifier, tags: z.array(z.string()).optional() })),
    await reader.read("/workers/scripts"),
    "Worker inventory"
  );
  const candidates = workers.filter(
    ({ tags }) =>
      tags?.includes("alchemy:stack:MealPlanner") &&
      tags.includes("alchemy:id:MealPlannerApi")
  );
  return Promise.all(
    candidates.map((worker) => readWorkerTarget(reader, profile, worker.id))
  );
};

export const readLocalMigrations = async (
  directory: string
): Promise<readonly LocalMigration[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        if (!entry.isDirectory() || !/^\d{14}_[\w-]+$/u.test(entry.name)) {
          throw new Error("Unsupported entry in D1 migration directory");
        }
        const files = await readdir(`${directory}/${entry.name}`, {
          withFileTypes: true,
        });
        if (
          !files.some((file) => file.name === "migration.sql") ||
          files.some(
            (file) =>
              !file.isFile() ||
              !["migration.sql", "snapshot.json"].includes(file.name)
          )
        ) {
          throw new Error("Unsupported D1 migration files or aliases");
        }
        const sql = await readFile(`${directory}/${entry.name}/migration.sql`);
        return {
          hash: createHash("sha256").update(sql).digest("hex"),
          name: entry.name,
        };
      })
  );
  if (migrations.length === 0) {
    throw new Error("D1 migration directory is empty");
  }
  return migrations;
};

const columnSchema = z.object({
  cid: z.number().int().nonnegative(),
  dflt_value: z.string().nullable(),
  name: z.string(),
  notnull: z.number().int(),
  pk: z.number().int(),
  type: z.string(),
});
const legacyRowSchema = z.object({
  applied_at: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
});
const alchemyRowSchema = z.object({
  applied_at: z.string().min(1),
  created_at: z.number().int().nonnegative().nullable(),
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  id: z.number().int().positive(),
  name: z.string().min(1),
});

// eslint-disable-next-line anti-slop/no-unknown-parameters -- PRAGMA is an untrusted network result, including possible absence; decode before classification.
const ledgerShape = (columns: unknown): "alchemy" | "legacy" => {
  const parsed = decode(z.array(columnSchema), columns, "D1 ledger columns");
  const names = parsed
    .map(({ name }) => name)
    .toSorted()
    .join(",");
  const id = parsed.find(({ name }) => name === "id");
  if (
    names === "applied_at,id,name" &&
    id?.type.toUpperCase() === "TEXT" &&
    id.pk === 1 &&
    parsed
      .filter(({ name }) => name !== "id")
      .every(({ notnull }) => notnull === 1)
  ) {
    return "legacy";
  }
  if (
    names === "applied_at,created_at,hash,id,name" &&
    id?.type.toUpperCase() === "INTEGER" &&
    id.pk === 1 &&
    parsed.find(({ name }) => name === "hash")?.notnull === 1
  ) {
    return "alchemy";
  }
  throw new Error(
    "Absent or unsupported D1 ledger layout; new-stage provisioning is outside this gate"
  );
};

const migrationCreatedAt = (name: string): number => {
  const timestamp = Date.parse(
    `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T${name.slice(8, 10)}:${name.slice(10, 12)}:${name.slice(12, 14)}Z`
  );
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("Invalid local D1 migration timestamp");
  }
  return timestamp;
};

export const checkLedger = (
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- PRAGMA results are decoded before classifying the ledger.
  columns: unknown,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- Query rows are decoded against the selected ledger shape before matching files.
  rows: unknown,
  migrations: readonly LocalMigration[]
) => {
  const shape = ledgerShape(columns);
  const history =
    shape === "legacy"
      ? decode(z.array(legacyRowSchema), rows, "legacy D1 history")
      : decode(z.array(alchemyRowSchema), rows, "Alchemy D1 history");
  if (history.length === 0) {
    throw new Error(
      "Empty D1 history is outside the existing-database release gate"
    );
  }
  const aliases = new Map<string, LocalMigration>();
  for (const migration of migrations) {
    for (const alias of [migration.name, `${migration.name}/migration.sql`]) {
      if (aliases.has(alias)) {
        throw new Error("Duplicate local D1 migration alias");
      }
      aliases.set(alias, migration);
    }
  }
  const applied = new Set<string>();
  const ids = new Set<string | number>();
  const reconstructedRows = [];
  for (const [index, row] of history.entries()) {
    const migration = aliases.get(row.name);
    if (migration === undefined) {
      throw new Error("Remote D1 history contains an unknown migration");
    }
    if (applied.has(migration.name) || ids.has(row.id)) {
      throw new Error("Duplicate remote D1 migration alias or ID");
    }
    if (shape === "alchemy" && row.id !== index + 1) {
      throw new Error("Remote D1 migration IDs contain a gap");
    }
    if (migrations[index]?.name !== migration.name) {
      throw new Error("Remote D1 history is not a prefix of local migrations");
    }
    if ("hash" in row && row.hash !== migration.hash) {
      throw new Error("Historical D1 SQL differs from its stored hash");
    }
    applied.add(migration.name);
    ids.add(row.id);
    if (shape === "legacy") {
      reconstructedRows.push({
        applied_at: row.applied_at,
        created_at: migrationCreatedAt(migration.name),
        hash: migration.hash,
        id: index + 1,
        name: row.name,
      });
    }
  }
  // Convert.ts fills both hashes and timestamps from local records. A native
  // five-column ledger cannot be distinguished from conversion using rows alone.
  return {
    applied: [...applied],
    columns: decode(z.array(columnSchema), columns, "D1 ledger columns"),
    conversion:
      shape === "legacy"
        ? {
            columns: ["id", "hash", "created_at", "name", "applied_at"],
            rows: reconstructedRows,
          }
        : null,
    effect:
      shape === "legacy"
        ? "reconstruct-hashes-and-timestamps-from-release-files-before-pending-migrations"
        : "apply-pending-migrations-with-name-based-detection",
    hashEvidence: shape === "legacy" ? "absent" : "matches-stored-hashes",
    layout: shape,
    originalSqlProvenance: "unknown",
    pending: migrations
      .filter((migration) => !applied.has(migration.name))
      .map(({ name }) => name),
    rows: history,
  } as const;
};

// Alchemy retries use the top-level attr, including an interrupted update.
const executorStateSchema = z.object({
  attr: z.object({
    accountId: account,
    databaseId: z.uuid(),
    databaseName: identifier,
  }),
  fqn: identifier,
  kind: z.literal("resource").optional(),
  logicalId: identifier,
  providerMode: z.literal("live").optional(),
  resourceType: z.literal("Cloudflare.D1Database"),
  status: z.enum(["created", "updated", "updating"]),
});

export const inspectD1Target = async (
  reader: D1Reader,
  target: D1Target,
  local: Readonly<Record<Resource, readonly LocalMigration[]>>
) => {
  if (reader.accountId !== target.accountId) {
    throw new Error("Resolved Cloudflare account differs from D1 target");
  }
  const live = await readWorkerTarget(reader, target.profile, target.worker);
  if (JSON.stringify(live) !== JSON.stringify(target)) {
    throw new Error(
      "Live Worker stage or D1 binding identities differ from the frozen target"
    );
  }
  const saved = decode(
    z.tuple([executorStateSchema, executorStateSchema]),
    await reader.readState(target.stage),
    "existing Alchemy D1 state"
  );
  const executorTargets = saved.map((state, index) => {
    const resource = resources[index];
    if (
      resource === undefined ||
      state.fqn !== resource ||
      state.logicalId !== resource ||
      state.attr.accountId !== target.accountId ||
      state.attr.databaseId !== target.databases[resource].uuid ||
      state.attr.databaseName !== target.databases[resource].name
    ) {
      throw new Error(
        "Alchemy executor D1 identity differs from the frozen target"
      );
    }
    return state;
  });
  const databases = await Promise.all(
    resources.map(async (resource) => {
      const path = `/d1/database/${target.databases[resource].uuid}`;
      const columns = await reader.read(`${path}/query`, sqlQueries.columns);
      const shape = ledgerShape(columns);
      const rows = await reader.read(`${path}/query`, sqlQueries[shape]);
      const history = checkLedger(columns, rows, local[resource]);
      const schema = decode(
        z.array(
          z.object({
            name: z.string(),
            sql: z.string().nullable(),
            tbl_name: z.string(),
            type: z.enum(["table", "index", "trigger", "view"]),
          })
        ),
        await reader.read(`${path}/query`, sqlQueries.schema),
        "D1 schema"
      );
      if (
        schema.some(({ name }) =>
          [
            "__drizzle_migrations",
            "__alchemy_migrations",
            "_prisma_migrations",
            "d1_migrations_alchemy_upgrade",
          ].includes(name)
        )
      ) {
        throw new Error("Unexpected alternate D1 migration history table");
      }
      if (
        !schema.some(
          ({ name, type }) => name === "d1_migrations" && type === "table"
        )
      ) {
        throw new Error(
          "Observed D1 schema is missing its migration ledger table"
        );
      }
      const recovery = decode(
        z.object({ bookmark: z.string().min(1) }),
        await reader.read(`${path}/time_travel/bookmark`),
        "current D1 recovery bookmark"
      );
      return {
        ...history,
        recoveryBookmark: recovery.bookmark,
        resource,
        schema,
      };
    })
  );
  return {
    checkedAt: new Date().toISOString(),
    databases,
    executorTargets,
    target,
  } as const;
};

/** A drift reference for observed state, never an authorization or origin proof. */
export const evidenceDigest = (
  report: Awaited<ReturnType<typeof inspectD1Target>>,
  release: Release
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        databases: report.databases.map(
          ({ recoveryBookmark: _bookmark, ...observed }) => observed
        ),
        executorTargets: report.executorTargets,
        release,
        target: report.target,
      })
    )
    .digest("hex");

export const verifyEvidence = (observed: string, reviewed: string): void => {
  if (!/^[a-f0-9]{64}$/u.test(reviewed) || observed !== reviewed) {
    throw new Error(
      "D1 evidence changed or is missing; inspect the current target, release, ledger and schema before deployment"
    );
  }
};

const makeReader = async (
  profile: string,
  accountId: string
): Promise<D1Reader> => {
  // Pinned Alchemy has no public export for its Cloudflare auth provider.
  // Read an existing profile through that provider; never configure or bootstrap.
  const [
    {
      AlchemyProfile,
      AuthProviders,
      CredentialsStore,
      CredentialsStoreLive,
      ProfileLive,
      getAuthProvider,
    },
    { CloudflareAuth },
    { makeHttpStateStore },
    { PlatformServices },
    { loadConfigProvider },
    Effect,
    Layer,
    Redacted,
    FetchHttpClient,
    ConfigProvider,
    Option,
  ] = await Promise.all([
    import("alchemy/Auth"),
    import("../node_modules/alchemy/lib/Cloudflare/Auth/AuthProvider.js"),
    import("alchemy/State"),
    import("alchemy/Util/PlatformServices"),
    import("alchemy/Util/ConfigProvider"),
    import("effect/Effect"),
    import("effect/Layer"),
    import("effect/Redacted"),
    import("effect/unstable/http/FetchHttpClient"),
    import("effect/ConfigProvider"),
    import("effect/Option"),
  ]);
  const configProvider = await Effect.runPromise(
    loadConfigProvider(Option.none()).pipe(Effect.provide(PlatformServices))
  );
  const base = Layer.mergeAll(
    PlatformServices,
    Layer.provide(ProfileLive, PlatformServices),
    Layer.provide(CredentialsStoreLive, PlatformServices),
    FetchHttpClient.layer,
    Layer.succeed(AuthProviders, {}),
    ConfigProvider.layer(configProvider)
  );
  const credentials = await Effect.runPromise(
    Effect.gen(function* credentials() {
      const profiles = yield* AlchemyProfile;
      const configured = yield* profiles.getProfile(profile);
      const config = configured?.["Cloudflare"];
      if (config === undefined) {
        return yield* Effect.fail(
          new Error("Existing Cloudflare profile required")
        );
      }
      const provider = yield* getAuthProvider<
        CloudflareAuthConfig,
        CloudflareResolvedCredentials
      >("Cloudflare");
      const parsed = decode(
        z.discriminatedUnion("method", [
          z.object({ method: z.literal("env") }),
          z.object({
            credentialType: z.enum(["apiToken", "apiKey"]),
            method: z.literal("stored"),
          }),
          z.object({
            accountId: account,
            method: z.literal("oauth"),
            scopes: z.array(z.string()),
          }),
        ]),
        config,
        "Cloudflare profile configuration"
      );
      return yield* provider.read(profile, parsed);
    }).pipe(
      Effect.provide(Layer.provideMerge(CloudflareAuth, base)),
      Effect.scoped,
      Effect.timeout("30 seconds")
    )
  ).catch(() => {
    throw new Error(
      "Could not read the existing Cloudflare profile; complete sign-in separately"
    );
  });
  if (credentials.accountId !== accountId) {
    throw new Error(
      "Resolved Cloudflare profile account differs from requested account"
    );
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  if (credentials.type === "apiKey") {
    headers.set("X-Auth-Key", Redacted.value(credentials.apiKey));
    headers.set("X-Auth-Email", Redacted.value(credentials.email));
  } else {
    headers.set(
      "Authorization",
      `Bearer ${Redacted.value(credentials.type === "oauth" ? credentials.accessToken : credentials.apiToken)}`
    );
  }
  return {
    accountId,
    read: async (path, sql) => {
      const request: RequestInit = {
        headers,
        method: sql === undefined ? "GET" : "POST",
        signal: AbortSignal.timeout(30_000),
      };
      if (sql !== undefined) {
        request.body = JSON.stringify({ sql });
      }
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
        request
      ).catch(() => {
        throw new Error("Cloudflare preflight request failed");
      });
      if (!response.ok) {
        throw new Error(
          `Cloudflare preflight request failed (HTTP ${response.status})`
        );
      }
      const envelope = decode(
        z.object({
          result: z.unknown(),
          result_info: z
            .object({ total_pages: z.number().optional() })
            .optional(),
          success: z.literal(true),
        }),
        await response.json(),
        "Cloudflare preflight response"
      );
      if ((envelope.result_info?.total_pages ?? 1) > 1) {
        throw new Error(
          "Incomplete Cloudflare inventory; paginated results require explicit discovery support"
        );
      }
      if (sql === undefined) {
        return envelope.result;
      }
      const results = decode(
        z.tuple([
          z.object({ results: z.array(z.unknown()), success: z.literal(true) }),
        ]),
        envelope.result,
        "D1 read result"
      );
      return results[0].results;
    },
    readState: async (stage) =>
      await Effect.runPromise(
        Effect.gen(function* readExistingD1State() {
          const store = yield* CredentialsStore;
          const cached = decode(
            z.object({
              accountId: account,
              authToken: z.string().min(1),
              url: z.url().startsWith("https://"),
            }),
            yield* store.read(profile, "cloudflare-state-store"),
            "existing state-store credentials"
          );
          if (cached.accountId !== accountId) {
            return yield* Effect.fail(
              new Error("State-store account differs from D1 target")
            );
          }
          const state = yield* makeHttpStateStore({
            ...cached,
            id: "cloudflare-http",
          });
          if ((yield* state.getVersion()) !== 7) {
            return yield* Effect.fail(
              new Error("Unsupported existing state-store version")
            );
          }
          return yield* Effect.all(
            resources.map((fqn) =>
              state.get({ fqn, stack: "MealPlanner", stage })
            )
          );
        }).pipe(
          Effect.provide(base),
          Effect.scoped,
          Effect.timeout("30 seconds")
        )
      ).catch(() => {
        throw new Error(
          "Could not read existing Alchemy D1 state; verify the same-account state-store version and complete its sign-in separately"
        );
      }),
  };
};

const options = (args: readonly string[]) => {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      name === undefined ||
      !["--target", "--profile", "--account", "--stage", "--evidence"].includes(
        name
      ) ||
      value === undefined ||
      value.startsWith("--") ||
      parsed.has(name)
    ) {
      throw new Error("Expected unique preflight options with explicit values");
    }
    parsed.set(name, value);
  }
  return parsed;
};

const readRelease = (
  local: Readonly<Record<Resource, readonly LocalMigration[]>>
): Release => {
  const status = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    { cwd: repository, encoding: "utf-8" }
  );
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf-8",
  });
  if (
    status.status !== 0 ||
    status.stdout.length !== 0 ||
    head.status !== 0 ||
    !/^[a-f0-9]{40}\n$/u.test(head.stdout)
  ) {
    throw new Error(
      "D1 inspection requires a clean, committed release checkout"
    );
  }
  const installed = decode(
    z.object({ version: z.literal("2.0.0-beta.76") }),
    JSON.parse(
      readFileSync(`${repository}/node_modules/alchemy/package.json`, "utf-8")
    ),
    "supported Alchemy version"
  );
  return {
    head: head.stdout.trim(),
    local,
    toolchain: { alchemy: installed.version, node: process.version },
  };
};

const main = async (args: readonly string[]): Promise<number> => {
  process.chdir(repository);
  const [command, ...rest] = args;
  const parsed = options(rest[0] === "--" ? rest.slice(1) : rest);
  if (command === "discover") {
    if (
      parsed.has("--target") ||
      parsed.has("--stage") ||
      parsed.has("--evidence")
    ) {
      throw new Error("Discovery accepts only --profile and --account");
    }
    const profile = decode(identifier, parsed.get("--profile"), "profile");
    const accountId = decode(account, parsed.get("--account"), "account");
    const reader = await makeReader(profile, accountId);
    process.stdout.write(
      `${JSON.stringify(await discoverD1Targets(reader, profile), null, 2)}\n`
    );
    return 0;
  }
  if (
    (command !== "inspect" && command !== "verify") ||
    parsed.has("--account")
  ) {
    throw new Error(
      "Expected discover --profile <profile> --account <id> or inspect --target <path>"
    );
  }
  const targetPath = parsed.get("--target");
  if (targetPath === undefined) {
    throw new Error("inspect requires a frozen --target file");
  }
  const target = parseD1Target(JSON.parse(await readFile(targetPath, "utf-8")));
  for (const name of ["profile", "stage"] as const) {
    if (parsed.has(`--${name}`) && parsed.get(`--${name}`) !== target[name]) {
      throw new Error(`Deployment ${name} differs from frozen D1 target`);
    }
  }
  const local = {
    MealPlannerAuthDatabase: await readLocalMigrations(
      `${repository}/${migrationDirectories.MealPlannerAuthDatabase}`
    ),
    ProviderAccountingDatabase: await readLocalMigrations(
      `${repository}/${migrationDirectories.ProviderAccountingDatabase}`
    ),
  };
  const release = readRelease(local);
  const reviewed = parsed.get("--evidence");
  if (command === "verify") {
    decode(
      z.string().regex(/^[a-f0-9]{64}$/u),
      reviewed,
      "reviewed --evidence digest"
    );
  }
  if (command !== "verify" && reviewed !== undefined) {
    throw new Error(
      "inspect generates evidence; it does not accept --evidence"
    );
  }
  const reader = await makeReader(target.profile, target.accountId);
  const report = await inspectD1Target(reader, target, local);
  if (JSON.stringify(readRelease(local)) !== JSON.stringify(release)) {
    throw new Error("Repository changed during D1 inspection");
  }
  const digest = evidenceDigest(report, release);
  process.stdout.write(
    `${JSON.stringify({ ...report, digest, release }, null, 2)}\n`
  );
  if (command === "verify" && reviewed !== undefined) {
    verifyEvidence(digest, reviewed);
  }
  return 0;
};

const [, entrypoint] = process.argv;
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error: unknown) {
    process.stderr.write(
      `D1 preflight: ${error instanceof Error && !(error instanceof SyntaxError) ? error.message : "invalid input"}\n`
    );
    process.exitCode = 1;
  }
}
