import { fork } from "node:child_process";
import type { Serializable } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Data, Effect, Exit, Fiber, Schema, Scope } from "effect";
import { Miniflare } from "miniflare";

import { pricedTokenUsage } from "../../apps/api/src/features/imports/import-provider-kernel.js";
import { makeProviderAccountingDatabase } from "../../apps/api/src/features/provider-accounting/provider-accounting.database.js";
import {
  ProviderAccountingDispatchId,
  ProviderAccountingProviderStageId,
  ProviderAccountingRunId,
  ProviderAccountingTimestamp,
  runAccountedProviderDispatch,
} from "../../apps/api/src/features/provider-accounting/provider-accounting.js";
import { makeD1ProviderAccountingRepository } from "../../apps/api/src/features/provider-accounting/provider-accounting.repository.d1.js";
import { workerObservability } from "../../apps/api/src/infrastructure/worker-observability.js";

const Count = Schema.Int.pipe(
  Schema.check(
    Schema.isBetween({ maximum: Number.MAX_SAFE_INTEGER, minimum: 0 })
  )
);
const Price = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
);
const MaximumReservation = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ maximum: 1_000_000, minimum: 1 }))
);
const Configuration = Schema.Struct({
  bridgeTimeoutMs: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 900_000, minimum: 1 }))
  ),
  maximumInvocations: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 10, minimum: 1 }))
  ),
  maximumReservedMicroUsd: MaximumReservation,
  rootDirectory: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  runId: ProviderAccountingRunId,
});

export const EvaluationInvocation = Schema.Struct({
  body: Schema.Json,
  dispatchId: ProviderAccountingDispatchId,
  inputMicroUsdPerToken: Price,
  maximumCostMicroUsd: MaximumReservation,
  model: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^@(?:cf|hf)\/[a-zA-Z0-9_./-]+$/u))
  ),
  outputMicroUsdPerToken: Price,
});
export type EvaluationInvocation = typeof EvaluationInvocation.Type;

const ProviderUsage = Schema.Struct({
  completion_tokens: Schema.optionalKey(Count),
  input_tokens: Schema.optionalKey(Count),
  output_tokens: Schema.optionalKey(Count),
  prompt_tokens: Schema.optionalKey(Count),
});
const UsageEnvelope = Schema.Struct({
  result: Schema.optionalKey(
    Schema.Struct({ usage: Schema.optionalKey(ProviderUsage) })
  ),
  usage: Schema.optionalKey(ProviderUsage),
});

export const EvaluationBridgeResponse = Schema.Struct({
  body: Schema.Json,
  dispatchId: ProviderAccountingDispatchId,
  headers: Schema.Record(Schema.String, Schema.String),
  latencyMs: Count,
  requestSha256: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/u))
  ),
  status: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 599, minimum: 100 }))
  ),
});
export type EvaluationBridgeResponse = typeof EvaluationBridgeResponse.Type;

class EvaluationTransportError extends Data.TaggedError(
  "EvaluationTransportError"
)<{ readonly code: string }> {}

const io = <A>(operation: (signal: AbortSignal) => Promise<A>, code: string) =>
  Effect.tryPromise({
    catch: () => new EvaluationTransportError({ code }),
    try: operation,
  });

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const parseJson = (value: string): unknown => JSON.parse(value);

export const evaluationBridgePaths = (
  rootDirectory: string,
  dispatchId: string
) => {
  const stem = path.join(
    path.resolve(rootDirectory),
    "bridge",
    hash(dispatchId)
  );
  return { request: `${stem}.request.json`, response: `${stem}.response.json` };
};

type EvaluationDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;

const migrate = async (database: EvaluationDatabase) => {
  await database
    .prepare(
      "CREATE TABLE IF NOT EXISTS evaluation_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)"
    )
    .run();
  const directory = fileURLToPath(
    new URL("../../apps/api/provider-accounting-migrations/", import.meta.url)
  );
  const entries = await readdir(directory, { recursive: true });
  const names = entries.filter((name) => name.endsWith(".sql")).toSorted();
  /* eslint-disable no-await-in-loop -- SQL migrations must commit in order. */
  for (const name of names) {
    const sql = await readFile(path.join(directory, name), "utf-8");
    const digest = hash(sql);
    const applied = await database
      .prepare("SELECT sha256 FROM evaluation_migrations WHERE name = ?")
      .bind(name)
      .first();
    if (applied !== null) {
      if (applied["sha256"] !== digest) {
        throw new EvaluationTransportError({ code: "migration_changed" });
      }
      continue;
    }
    // These are the repository's real Drizzle statements, including complete trigger bodies.
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await database.batch([
      ...statements.map((statement) => database.prepare(statement)),
      database
        .prepare(
          "INSERT INTO evaluation_migrations (name, sha256) VALUES (?, ?)"
        )
        .bind(name, digest),
    ]);
  }
  /* eslint-enable no-await-in-loop */
};

const installEvaluationLimits = async (
  database: EvaluationDatabase,
  configuration: typeof Configuration.Type
) => {
  await database
    .prepare(
      "CREATE TABLE IF NOT EXISTS evaluation_limits (id INTEGER PRIMARY KEY CHECK(id = 1), maximum_invocations INTEGER NOT NULL, maximum_reserved_micro_usd INTEGER NOT NULL)"
    )
    .run();
  await database
    .prepare("INSERT OR IGNORE INTO evaluation_limits VALUES (1, ?, ?)")
    .bind(
      configuration.maximumInvocations,
      configuration.maximumReservedMicroUsd
    )
    .run();
  const saved = await database
    .prepare("SELECT * FROM evaluation_limits WHERE id = 1")
    .first();
  if (
    saved?.["maximum_invocations"] !== configuration.maximumInvocations ||
    saved["maximum_reserved_micro_usd"] !==
      configuration.maximumReservedMicroUsd
  ) {
    throw new EvaluationTransportError({ code: "persisted_limits_mismatch" });
  }
  // The production ledger has a fixed $10 cap. This local trigger adds a stricter
  // cumulative reservation cap: settling cheaply never replenishes evaluation authority.
  await database
    .prepare(`CREATE TRIGGER IF NOT EXISTS evaluation_reservation_limit
    BEFORE INSERT ON provider_accounting_dispatches
    WHEN NOT EXISTS (SELECT 1 FROM provider_accounting_dispatches WHERE dispatch_id = NEW.dispatch_id)
    BEGIN
      SELECT CASE WHEN
        (SELECT COUNT(*) FROM provider_accounting_dispatches) >= (SELECT maximum_invocations FROM evaluation_limits WHERE id = 1)
        OR (SELECT COALESCE(SUM(maximum_cost_micro_usd), 0) FROM provider_accounting_dispatches) + NEW.maximum_cost_micro_usd > (SELECT maximum_reserved_micro_usd FROM evaluation_limits WHERE id = 1)
        THEN RAISE(ABORT, 'evaluation reservation limit reached') END;
    END`)
    .run();
};

const waitForResponse = async (
  responsePath: string,
  timeoutMs: number,
  signal: AbortSignal
) => {
  const deadline = Date.now() + timeoutMs;
  /* eslint-disable no-await-in-loop -- Only one bounded response poll may be in flight. */
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const file = await open(responsePath, "r").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    );
    if (file !== null) {
      try {
        return Schema.decodeUnknownSync(EvaluationBridgeResponse)(
          parseJson(await file.readFile("utf-8"))
        );
      } finally {
        await file.close();
      }
    }
    await delay(Math.min(100, Math.max(1, deadline - Date.now())), undefined, {
      signal,
    });
  }
  /* eslint-enable no-await-in-loop */
  throw new EvaluationTransportError({
    code: "response_missing_outcome_unknown",
  });
};

const usageFromBody = (body: Schema.Json) => {
  const decoded = Schema.decodeUnknownOption(UsageEnvelope)(body);
  if (decoded._tag === "None") {
    return { inputTokens: undefined, outputTokens: undefined };
  }
  const usage = decoded.value.result?.usage ?? decoded.value.usage;
  return {
    inputTokens: usage?.input_tokens ?? usage?.prompt_tokens,
    outputTokens: usage?.output_tokens ?? usage?.completion_tokens,
  };
};

export const createAccountedEvaluationTransport = async (options: {
  readonly rootDirectory: string;
  readonly runId: string;
  readonly maximumInvocations?: number;
  readonly maximumReservedMicroUsd?: number;
  readonly bridgeTimeoutMs?: number;
}) => {
  const configuration = Schema.decodeUnknownSync(Configuration)({
    bridgeTimeoutMs: 600_000,
    maximumInvocations: 10,
    maximumReservedMicroUsd: 1_000_000,
    ...options,
  });
  const rootDirectory = path.resolve(configuration.rootDirectory);
  await mkdir(path.join(rootDirectory, "bridge"), {
    mode: 0o700,
    recursive: true,
  });
  const lockPath = path.join(rootDirectory, "transport.lock");
  // A crash leaves this lock and the invoking ledger entry intact. Recovery must
  // inspect the original dispatch; starting a fresh invocation is not a retry.
  const lock = await open(lockPath, "wx", 0o600);
  const scope = Scope.makeUnsafe();
  let runtime: Miniflare | undefined;
  let closing: Promise<void> | null = null;
  const closeResources = async () => {
    try {
      // Cancelling the owned fibers waits for native unknown-cost settlement
      // before the D1 runtime becomes unavailable.
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await runtime?.dispose();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  };
  const close = () => {
    closing ??= closeResources();
    return closing;
  };
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, runId: configuration.runId })
    );
    runtime = new Miniflare({
      cf: false,
      resourcePersistencePath: path.join(rootDirectory, "ledger"),
      telemetry: { enabled: false },
      workers: [
        {
          config: {
            compatibilityDate: workerObservability.compatibility.date,
            env: {
              ProviderAccountingDatabase: {
                id: "RecipeExtractionEvaluation",
                type: "d1",
              },
            },
            manifest: {
              mainModule: "worker.mjs",
              modules: {
                "worker.mjs": {
                  contents:
                    "export default { fetch() { return new Response('ok'); } }",
                  type: "esm",
                },
              },
            },
            name: "evaluation-accounting",
          },
        },
      ],
    });
    const database = await runtime.getD1Database("ProviderAccountingDatabase");
    await migrate(database);
    await installEvaluationLimits(database, configuration);
    const repository = makeD1ProviderAccountingRepository(
      makeProviderAccountingDatabase(database)
    );
    const runInvocation = (rawRequest: EvaluationInvocation) =>
      Effect.gen(function* invokeEvaluation() {
        if (closing !== null) {
          return yield* Effect.fail(
            new EvaluationTransportError({ code: "transport_closed" })
          );
        }
        const request =
          yield* Schema.decodeUnknownEffect(EvaluationInvocation)(rawRequest);
        const files = evaluationBridgePaths(rootDirectory, request.dispatchId);
        const requestSha256 = hash(JSON.stringify(request));
        yield* io(async () => {
          const persisted = await readFile(files.request, "utf-8").catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") {
                return null;
              }
              throw error;
            }
          );
          if (persisted !== null) {
            const identity = Schema.decodeUnknownSync(
              Schema.Struct({ requestSha256: Schema.String })
            )(parseJson(persisted));
            if (identity.requestSha256 !== requestSha256) {
              throw new EvaluationTransportError({
                code: "dispatch_request_conflict",
              });
            }
          }
        }, "dispatch_request_conflict");
        const reservation = {
          dispatchId: request.dispatchId,
          maximumCostMicroUsd: request.maximumCostMicroUsd,
          providerStageId: Schema.decodeUnknownSync(
            ProviderAccountingProviderStageId
          )("recipe-extraction"),
          runId: configuration.runId,
          timestamp: Schema.decodeUnknownSync(ProviderAccountingTimestamp)(
            new Date().toISOString()
          ),
        };
        return yield* runAccountedProviderDispatch({
          invoke: io(async (signal) => {
            // Publication happens only after the production ledger claims invocation.
            await writeFile(
              `${files.request}.tmp`,
              JSON.stringify(
                {
                  ...request,
                  accounting: {
                    reservationMicroUsd: request.maximumCostMicroUsd,
                    state: "invoking",
                  },
                  requestSha256,
                  responseFile: files.response,
                },
                null,
                2
              ),
              { flag: "wx", mode: 0o600 }
            );
            await rename(`${files.request}.tmp`, files.request);
            const response = await waitForResponse(
              files.response,
              configuration.bridgeTimeoutMs,
              signal
            );
            if (
              response.dispatchId !== request.dispatchId ||
              response.requestSha256 !== requestSha256
            ) {
              throw new EvaluationTransportError({
                code: "response_identity_mismatch",
              });
            }
            const usage = usageFromBody(response.body);
            const cost = pricedTokenUsage(
              usage.inputTokens,
              usage.outputTokens,
              request
            );
            return {
              cost,
              value: {
                ...response,
                cost,
                reservationMicroUsd: request.maximumCostMicroUsd,
                usage,
              },
            };
          }, "bridge_outcome_unknown"),
          prepare: io(async () => {
            await Promise.all(
              [files.request, files.response].map(async (filePath) => {
                const existing = await open(filePath, "r").catch(
                  (error: NodeJS.ErrnoException) => {
                    if (error.code === "ENOENT") {
                      return null;
                    }
                    throw error;
                  }
                );
                if (existing !== null) {
                  await existing.close();
                  throw new EvaluationTransportError({
                    code: "bridge_file_already_exists",
                  });
                }
              })
            );
          }, "bridge_preparation_failed"),
          repository,
          reservation,
        });
      });
    const invoke = (request: EvaluationInvocation) =>
      Effect.acquireUseRelease(
        Effect.forkIn(runInvocation(request), scope, {
          uninterruptible: false,
        }),
        Fiber.join,
        Fiber.interrupt
      );
    return {
      close,
      invoke,
      readLedger: () =>
        io(async () => {
          const [budget, dispatches, limits] = await Promise.all([
            database.prepare("SELECT * FROM provider_accounting_budgets").all(),
            database
              .prepare(
                "SELECT * FROM provider_accounting_dispatches ORDER BY created_at, dispatch_id"
              )
              .all(),
            database.prepare("SELECT * FROM evaluation_limits").all(),
          ]);
          return {
            budget: budget.results,
            dispatches: dispatches.results,
            limits: limits.results,
          };
        }, "ledger_read_failed"),
    };
  } catch (error) {
    await close();
    throw error;
  }
};

const runCliWithSignal = async (signal: AbortSignal) => {
  const [command, rootDirectory, runId, requestFile] = process.argv.slice(3);
  if (
    command !== "bridge" ||
    rootDirectory === undefined ||
    runId === undefined ||
    requestFile === undefined
  ) {
    throw new Error(
      "Usage: accounted-transport.ts bridge ROOT_DIRECTORY RUN_ID REQUEST_JSON"
    );
  }
  const request = Schema.decodeUnknownSync(EvaluationInvocation)(
    parseJson(await readFile(requestFile, "utf-8"))
  );
  const transport = await createAccountedEvaluationTransport({
    rootDirectory,
    runId,
  });
  try {
    const result = await Effect.runPromiseExit(transport.invoke(request), {
      signal,
    });
    const ledger = await Effect.runPromise(transport.readLedger());
    const output =
      result._tag === "Success"
        ? {
            ledger,
            result: result.value,
            status:
              result.value._tag === "CompletedUnknownCost"
                ? "stopped_unknown"
                : "settled",
          }
        : {
            ledger,
            reason:
              "Inspect persisted ledger; no automatic retry is authorized",
            status: ledger.dispatches.some(
              (dispatch) =>
                dispatch["dispatch_id"] === request.dispatchId &&
                dispatch["state"] === "settled_unknown"
            )
              ? "stopped_unknown"
              : "stopped",
          };
    await writeFile(
      path.join(
        path.resolve(rootDirectory),
        `${hash(request.dispatchId)}.result.json`
      ),
      JSON.stringify(output, null, 2),
      { flag: "wx", mode: 0o600 }
    ).catch((error: NodeJS.ErrnoException) => {
      if (
        error.code === "EEXIST" &&
        result._tag === "Success" &&
        result.value._tag === "AlreadySettled"
      ) {
        return;
      }
      throw error;
    });
    console.log(
      JSON.stringify({
        dispatchId: request.dispatchId,
        rootDirectory: path.resolve(rootDirectory),
        status: output.status,
      })
    );
    if (output.status !== "settled") {
      process.exitCode = 1;
    }
  } finally {
    await transport.close();
  }
};

const CliChildMode = "--accounted-evaluation-child";
const InterruptCliChild = "interrupt-accounted-evaluation";

const runCliChild = async () => {
  const controller = new AbortController();
  const interrupt = (message: Serializable) => {
    if (Schema.is(Schema.Literal(InterruptCliChild))(message)) {
      controller.abort();
    }
  };
  const disconnect = () => controller.abort();
  process.on("message", interrupt);
  process.once("disconnect", disconnect);
  try {
    await runCliWithSignal(controller.signal);
  } finally {
    process.removeListener("message", interrupt);
    process.removeListener("disconnect", disconnect);
    if (process.connected) {
      process.disconnect?.();
    }
  }
};

const runCli = async () => {
  // Miniflare exits synchronously on OS signals. A native detached child keeps
  // its workerd process outside the launcher's signal group and receives graceful
  // interruption over IPC. Losing the parent also interrupts and settles safely.
  const child = fork(
    import.meta.filename,
    [CliChildMode, ...process.argv.slice(2)],
    {
      detached: true,
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    }
  );
  const interrupt = () => {
    if (child.connected) {
      child.send(InterruptCliChild);
    }
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const [code] = await once(child, "exit");
    process.exitCode =
      Schema.decodeUnknownSync(Schema.NullOr(Schema.Int))(code) ?? 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
};

const reportCliFailure = () => {
  console.error(
    "Evaluation transport stopped. Inspect the local ledger and bridge files before further action."
  );
  process.exitCode = 1;
};

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === import.meta.filename
) {
  await (
    process.argv[2] === CliChildMode && process.send !== undefined
      ? runCliChild()
      : runCli()
  ).catch(reportCliFailure);
}
