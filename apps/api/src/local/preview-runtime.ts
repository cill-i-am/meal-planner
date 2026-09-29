import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deserialize } from "node:v8";

import type * as NativeCloudflare from "@cloudflare/workers-types";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import type { MiniflareWorkerConfig } from "miniflare";

import { privateOutputRuntimeWorker } from "../features/private-output/private-output-runtime.test-fixture.js";
import { bundleWorkerFixture } from "../test/native-worker.test-fixture.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const migrationTable = "_local_auth_migrations";
const StoredNames = Schema.Array(Schema.Struct({ name: Schema.String }));
const StoredMigrations = Schema.Array(
  Schema.Struct({ name: Schema.String, sha256: Schema.String })
);
const WebBundle = Schema.Struct({
  bundle: Schema.Struct({
    files: Schema.NonEmptyArray(
      Schema.Struct({
        content: Schema.Union([Schema.String, Schema.Uint8Array]),
        path: Schema.String,
      })
    ),
  }),
  clientDirectory: Schema.String,
});

interface Migration {
  readonly name: string;
  readonly sha256: string;
  readonly statements: readonly string[];
}

export interface LocalPreviewOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly port: number;
  readonly dataDirectory: string;
  readonly authDatabaseId?: string;
  readonly gatewayId: string;
  readonly model: "openai/gpt-6-luna" | "@cf/openai/gpt-oss-120b";
}

export interface LocalPreviewRuntime {
  readonly baseURL: string;
  readonly stopped: Promise<void>;
  readonly stop: () => Promise<void>;
}

const readMigrations = async (): Promise<readonly Migration[]> => {
  const directory = path.join(root, "apps/api/auth-migrations");
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const entries = directoryEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  return Promise.all(
    entries.map(async (name) => {
      const source = await readFile(
        path.join(directory, name, "migration.sql"),
        "utf-8"
      );
      return {
        name,
        sha256: createHash("sha256").update(source).digest("hex"),
        statements: source
          .split("--> statement-breakpoint")
          .map((value) => value.trim())
          .filter(Boolean),
      };
    })
  );
};

const databaseNames = async (database: NativeCloudflare.D1Database) => {
  const result = await database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  return Schema.decodeUnknownSync(StoredNames)(result.results).map(
    ({ name }) => name
  );
};

/** Applies each source migration once and rejects edits to previously applied SQL. */
export const applyLocalAuthMigrations = async (
  database: NativeCloudflare.D1Database
): Promise<void> => {
  const migrations = await readMigrations();
  const existingTables = new Set(await databaseNames(database));
  const hasLegacyTables = [
    "account",
    "invitation",
    "member",
    "organization",
    "session",
    "user",
    "verification",
    "family",
  ].some((name) => existingTables.has(name));
  if (!existingTables.has(migrationTable)) {
    if (hasLegacyTables) {
      throw new Error(
        "Existing auth database has no migration ledger; baseline it explicitly before preview startup"
      );
    }
    await database
      .prepare(
        `CREATE TABLE ${migrationTable} (name TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL)`
      )
      .run();
  }
  const appliedResult = await database
    .prepare(`SELECT name, sha256 FROM ${migrationTable} ORDER BY name`)
    .all();
  const applied = Schema.decodeUnknownSync(StoredMigrations)(
    appliedResult.results
  );
  const byName = new Map(applied.map((row) => [row.name, row.sha256]));
  if (
    applied.some((row) => !migrations.some((item) => item.name === row.name))
  ) {
    throw new Error("Auth database contains an unknown migration");
  }
  let missingEarlier = false;
  for (const migration of migrations) {
    const previousHash = byName.get(migration.name);
    if (previousHash !== undefined) {
      if (missingEarlier || previousHash !== migration.sha256) {
        throw new Error("Auth migration history differs from source");
      }
      continue;
    }
    missingEarlier = true;
    // oxlint-disable-next-line no-await-in-loop -- Each migration depends on the prior committed schema.
    await database.batch([
      ...migration.statements.map((statement) => database.prepare(statement)),
      database
        .prepare(`INSERT INTO ${migrationTable} (name, sha256) VALUES (?, ?)`)
        .bind(migration.name, migration.sha256),
    ]);
  }
};

const authSecret = async (directory: string): Promise<string> => {
  const filename = path.join(directory, "auth-secret.hex");
  let value: string;
  try {
    value = await readFile(filename, "utf-8");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    const created = randomBytes(32).toString("hex");
    try {
      await writeFile(filename, created, { flag: "wx", mode: 0o600 });
      value = created;
    } catch (writeError) {
      if (
        !(writeError instanceof Error) ||
        !("code" in writeError) ||
        writeError.code !== "EEXIST"
      ) {
        throw writeError;
      }
      value = await readFile(filename, "utf-8");
    }
  }
  if (!/^[a-f\d]{64}$/u.test(value)) {
    throw new Error("Local auth secret is invalid");
  }
  const secretStat = await stat(filename);
  // oxlint-disable-next-line no-bitwise -- POSIX mode bits express group/world access.
  if ((secretStat.mode & 0o077) !== 0) {
    await chmod(filename, 0o600);
  }
  return value;
};

const gatewayManifest: NonNullable<MiniflareWorkerConfig["manifest"]> = {
  mainModule: "preview-gateway.js",
  modules: {
    "preview-gateway.js": {
      contents:
        "export default { fetch(request, env) { const path = new URL(request.url).pathname; if (path.startsWith('/__test/')) return new Response(null, { status: 404 }); return path === '/__local/ready' ? env.MEAL_PLANNER_API.fetch(request) : env.WEBSITE.fetch(request); } };",
      type: "esm",
    },
  },
};

/** Starts an isolated loopback preview. The caller may await `stopped` or call `stop`. */
export const startLocalPreview = async (
  options: LocalPreviewOptions
): Promise<LocalPreviewRuntime> => {
  if (!/^[a-f\d]{32}$/u.test(options.accountId)) {
    throw new Error("A valid Cloudflare account ID is required");
  }
  if (!/^\S+$/u.test(options.apiToken)) {
    throw new Error("A Workers AI API token is required");
  }
  if (!/^[a-z\d][a-z\d-]{0,63}$/u.test(options.gatewayId)) {
    throw new Error("A valid AI Gateway ID is required");
  }
  const modelConfig = JSON.stringify(
    options.model === "openai/gpt-6-luna"
      ? {
          gatewayId: options.gatewayId,
          maxOutputTokens: 8192,
          model: options.model,
          provider: "cloudflare-responses",
          timeoutMs: 120_000,
        }
      : {
          gatewayId: null,
          maxOutputTokens: 4096,
          model: options.model,
          timeoutMs: 120_000,
        }
  );
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new Error("Choose a valid preview port");
  }
  if (!path.isAbsolute(options.dataDirectory)) {
    throw new Error("Local preview data directory must be absolute");
  }
  const authDatabaseId = options.authDatabaseId ?? "meal-planner-local";
  if (!/^[a-z\d][a-z\d-]{0,63}$/u.test(authDatabaseId)) {
    throw new Error("Local auth database ID is invalid");
  }
  await mkdir(options.dataDirectory, { mode: 0o700, recursive: true });
  await chmod(options.dataDirectory, 0o700);
  const secret = await authSecret(options.dataDirectory);
  const baseURL = `http://127.0.0.1:${options.port}`;
  const [api, domain, output, website] = await Promise.all([
    bundleWorkerFixture(path.join(root, "apps/api/src/local/preview-api.ts")),
    bundleWorkerFixture(
      path.join(
        root,
        "apps/api/src/features/households/household-domain-service.test-fixture.js"
      )
    ),
    bundleWorkerFixture(
      path.join(
        root,
        "apps/api/src/features/private-output/private-output-worker.ts"
      )
    ),
    readFile(path.join(root, "apps/web/.worker-build/output.v8")).then(
      (bytes) => Schema.decodeUnknownSync(WebBundle)(deserialize(bytes))
    ),
  ]);
  const privateOutput = privateOutputRuntimeWorker(output);
  const runtime = new Miniflare({
    cf: false,
    host: "127.0.0.1",
    port: options.port,
    resourcePersistencePath: options.dataDirectory,
    workers: [
      {
        config: {
          assets: { directory: website.clientDirectory, hasUserWorker: true },
          compatibilityDate,
          compatibilityFlags,
          env: {
            MEAL_PLANNER_API: { type: "worker", worker: "api" },
            WEBSITE: { type: "worker", worker: "website" },
          },
          manifest: gatewayManifest,
          name: "local-preview-gateway",
          type: "worker",
        },
      },
      {
        config: {
          compatibilityDate,
          compatibilityFlags,
          env: { MEAL_PLANNER_API: { type: "worker", worker: "api" } },
          manifest: {
            mainModule: website.bundle.files[0].path,
            modules: Object.fromEntries(
              website.bundle.files.map((file) => [
                file.path,
                {
                  contents: Schema.is(Schema.String)(file.content)
                    ? file.content
                    : new Uint8Array(file.content),
                  type: /\.m?js$/u.test(file.path) ? "esm" : "data",
                },
              ])
            ),
          },
          name: "website",
          type: "worker",
        },
      },
      {
        config: {
          compatibilityDate,
          compatibilityFlags,
          env: {
            AGENT_CONVERSATION_CONFIG: { type: "text", value: modelConfig },
            AgentConversation: {
              exportName: "AgentConversation",
              type: "durable-object",
              worker: "api",
            },
            BASE_URL: { type: "text", value: baseURL },
            BETTER_AUTH_SECRET: { type: "text", value: secret },
            CLOUDFLARE_ACCOUNT_ID: {
              type: "text",
              value: options.accountId,
            },
            CLOUDFLARE_API_TOKEN: {
              type: "text",
              value: options.apiToken,
            },
            HouseholdDomainWorker: {
              type: "worker",
              worker: "household-domain",
            },
            LOCAL_MAIL: { id: "meal-planner-local-mail", type: "kv" },
            MealPlannerAuthDatabase: { id: authDatabaseId, type: "d1" },
            PrivateOutputApi: {
              exportName: "PrivateOutputApi",
              type: "worker",
              worker: "private-output",
            },
            PrivateOutputMutations: {
              exportName: "PrivateOutputMutations",
              type: "worker",
              worker: "private-output",
            },
          },
          exports: {
            AgentConversation: { storage: "sqlite", type: "durable-object" },
          },
          manifest: api,
          name: "api",
          type: "worker",
        },
      },
      {
        config: {
          compatibilityDate,
          compatibilityFlags,
          env: {
            HouseholdObject: {
              exportName: "HouseholdObject",
              type: "durable-object",
              worker: "household-domain",
            },
            PrivateOutputMutations: {
              exportName: "PrivateOutputMutations",
              type: "worker",
              worker: "private-output",
            },
          },
          exports: {
            HouseholdObject: { storage: "sqlite", type: "durable-object" },
          },
          manifest: domain,
          name: "household-domain",
          type: "worker",
        },
      },
      {
        config: {
          ...privateOutput.config,
          env: {
            ...privateOutput.config.env,
            PRIVATE_DISCOVERY_CONFIG: { type: "text", value: "" },
          },
        },
      },
    ],
  });
  try {
    const database = await runtime.getD1Database(
      "MealPlannerAuthDatabase",
      "api"
    );
    await applyLocalAuthMigrations(database);
    await runtime.ready;
    const response = await runtime.dispatchFetch(`${baseURL}/__local/ready`);
    if (!response.ok) {
      throw new Error("Local preview failed its readiness check");
    }
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  const signalHandler = { current: (): void => undefined };
  // oxlint-disable-next-line typescript/no-invalid-void-type -- This is a completion-only lifecycle promise.
  const stopped = Promise.withResolvers<void>();
  const stop = (): Promise<void> => {
    if (closePromise === undefined) {
      process.off("SIGINT", signalHandler.current);
      process.off("SIGTERM", signalHandler.current);
      closePromise = (async () => {
        try {
          await runtime.dispose();
          stopped.resolve();
        } catch (error) {
          stopped.reject(error);
          throw error;
        }
      })();
    }
    return closePromise;
  };
  signalHandler.current = () => {
    void (async () => {
      try {
        await stop();
      } catch {
        process.exitCode = 1;
      }
    })();
  };
  process.once("SIGINT", signalHandler.current);
  process.once("SIGTERM", signalHandler.current);
  return { baseURL, stop, stopped: stopped.promise };
};
