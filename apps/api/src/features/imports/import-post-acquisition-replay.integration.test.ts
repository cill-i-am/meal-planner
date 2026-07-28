import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import * as Bundle from "alchemy/Bundle";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const legacyFixturePath = fileURLToPath(
  new URL(
    "import-post-acquisition-replay.legacy-test-fixture.ts",
    import.meta.url
  )
);
const correctedFixturePath = fileURLToPath(
  new URL("import-post-acquisition-replay.test-fixture.ts", import.meta.url)
);
const temporaryDirectories: string[] = [];
let runtime: Miniflare | undefined;
let persistenceDirectory: string;
let legacyFixtureScript: string;
let correctedFixtureScript: string;

interface TestR2Bucket {
  readonly put: (
    key: string,
    value: Uint8Array,
    options: {
      readonly customMetadata: Readonly<Record<string, string>>;
      readonly httpMetadata: {
        readonly cacheControl: string;
        readonly contentType: string;
      };
      readonly sha256: ArrayBuffer;
    }
  ) => Promise<unknown>;
}

const buildFixture = async (input: string, outputDirectory: string) => {
  type BundlePlugin = NonNullable<
    Parameters<typeof Bundle.build>[0]["plugins"]
  >;
  const alchemyEntry = import.meta.resolve("alchemy");
  const pluginModule = new URL(
    "../../@distilled.cloud/cloudflare-rolldown-plugin/dist/plugin.js",
    alchemyEntry
  );
  const { default: cloudflareRolldown } = (await import(pluginModule.href)) as {
    readonly default: (options: {
      readonly compatibilityDate: string;
      readonly compatibilityFlags: string[];
    }) => BundlePlugin;
  };
  const output = await Effect.runPromise(
    Bundle.build(
      {
        checks: {
          ineffectiveDynamicImport: false,
          unresolvedImport: false,
        },
        external: ["cloudflare:workers"],
        input,
        plugins: [
          cloudflareRolldown({
            compatibilityDate,
            compatibilityFlags,
          }),
        ],
      },
      {
        codeSplitting: false,
        dir: outputDirectory,
        format: "esm",
        minify: true,
        sourcemap: false,
      }
    )
  );
  const {
    files: [{ content }],
  } = output;
  return typeof content === "string"
    ? content
    : new TextDecoder().decode(content);
};

const runtimeOptions = (script: string) => ({
  compatibilityDate,
  compatibilityFlags,
  d1Databases: { MealPlannerDatabase: "gaia-192-test" },
  d1Persist: persistenceDirectory,
  kvNamespaces: ["POST_ACQUISITION_REPLAY_STATE"],
  kvPersist: persistenceDirectory,
  modules: [
    {
      contents: script,
      path: "post-acquisition-replay-fixture.js",
      type: "ESModule" as const,
    },
  ],
  r2Buckets: ["ImportEvidenceBucket"],
  r2Persist: persistenceDirectory,
  workflows: {
    PostAcquisitionReplayWorkflow: {
      className: "PostAcquisitionReplayWorkflow",
      name: "post-acquisition-replay-workflow",
    },
  },
  workflowsPersist: persistenceDirectory,
});

const applyMigrations = async () => {
  if (runtime === undefined) {
    throw new Error("Miniflare runtime is not initialized");
  }
  const database = await runtime.getD1Database("MealPlannerDatabase");
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("../../../migrations", import.meta.url))
  );
  await database
    .prepare(
      `CREATE TABLE d1_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
         name TEXT NOT NULL UNIQUE,
         applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
       )`
    )
    .run();
  for (const migration of migrations) {
    // eslint-disable-next-line no-await-in-loop -- D1 migrations must be applied in declared order.
    await database.batch([
      ...migration.queries.map((query) => database.prepare(query)),
      database
        .prepare("INSERT INTO d1_migrations (name) VALUES (?)")
        .bind(migration.name),
    ]);
  }
};

beforeAll(async () => {
  persistenceDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-gaia-192-replay-`
  );
  temporaryDirectories.push(persistenceDirectory);
  const legacyOutput = await mkdtemp(
    `${tmpdir()}/meal-planner-gaia-192-legacy-bundle-`
  );
  const correctedOutput = await mkdtemp(
    `${tmpdir()}/meal-planner-gaia-192-corrected-bundle-`
  );
  temporaryDirectories.push(legacyOutput, correctedOutput);
  [legacyFixtureScript, correctedFixtureScript] = await Promise.all([
    buildFixture(legacyFixturePath, legacyOutput),
    buildFixture(correctedFixturePath, correctedOutput),
  ]);
  runtime = new Miniflare(runtimeOptions(legacyFixtureScript));
  await applyMigrations();
}, 30_000);

afterAll(async () => {
  await runtime?.dispose();
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

const commandWorkflow = async (
  command:
    | { readonly action: "read"; readonly id: string }
    | { readonly action: "restart"; readonly id: string }
    | { readonly action: "restart-legacy"; readonly id: string }
    | { readonly action: "restart-truncated"; readonly id: string }
    | { readonly id: string; readonly importId: string }
) => {
  if (runtime === undefined) {
    throw new Error("Miniflare runtime is not initialized");
  }
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify(command),
    method: "POST",
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  return JSON.parse(body) as unknown;
};

const commandWorkflowRaw = (command: {
  readonly action: "restart" | "restart-legacy" | "restart-truncated";
  readonly id: string;
}) => {
  if (runtime === undefined) {
    throw new Error("Miniflare runtime is not initialized");
  }
  return runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify(command),
    method: "POST",
  });
};

const sha256Hex = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const sha256Bytes = (hex: string) =>
  Uint8Array.from(
    hex.match(/.{2}/gu)?.map((byte) => Number.parseInt(byte, 16)) ?? []
  ).buffer;

const evidencePrefix = (importId: string) =>
  `imports/${importId}/acquisition/v1/generations/1`;

const seedAcquiringImport = async (
  importId: string,
  canonicalId = "7520000000000000192"
) => {
  if (runtime === undefined) {
    throw new Error("Miniflare runtime is not initialized");
  }
  const database = await runtime.getD1Database("MealPlannerDatabase");
  await database
    .prepare(
      `INSERT INTO recipe_imports (
         acquisition_generation, canonical_source_id,
         compatibility_fingerprint, created_at,
         evidence_references_json, id, recovery_action, source_kind,
         status, status_code, updated_at
       ) VALUES (?, ?, ?, ?, '[]', ?, NULL, 'tiktok', 'acquiring', NULL, ?)`
    )
    .bind(
      1,
      canonicalId,
      "b".repeat(64),
      "2026-07-28T09:59:00.000Z",
      importId,
      "2026-07-28T09:59:30.000Z"
    )
    .run();
};

const seedVerifiedAcquisitionEvidence = async (
  importId: string,
  canonicalId = "7520000000000000192"
) => {
  if (runtime === undefined) {
    throw new Error("Miniflare runtime is not initialized");
  }
  const bucket = (await runtime.getR2Bucket(
    "ImportEvidenceBucket"
  )) as unknown as TestR2Bucket;
  const media = new TextEncoder().encode("gaia-192-verified-media");
  const mediaSha256 = sha256Hex(media);
  const mediaKey = `${evidencePrefix(importId)}/original.mp4`;
  const manifestKey = `${evidencePrefix(importId)}/manifest.json`;
  const objectMetadata = (kind: "manifest" | "media", sha256: string) => ({
    generation: "1",
    importId,
    kind,
    sha256,
  });
  await bucket.put(mediaKey, media, {
    customMetadata: objectMetadata("media", mediaSha256),
    httpMetadata: {
      cacheControl: "private, no-store",
      contentType: "video/mp4",
    },
    sha256: sha256Bytes(mediaSha256),
  });
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      acquiredAt: "2026-07-28T10:00:00.000Z",
      audioStreams: [{ codec: "aac", index: 1 }],
      bytes: media.byteLength,
      canonicalId,
      canonicalUrl: `https://www.tiktok.com/@fixture/video/${canonicalId}`,
      caption: null,
      creator: {
        displayName: null,
        handle: null,
        id: null,
      },
      deleteAt: "2026-08-04T10:00:00.000Z",
      durationSeconds: 1,
      ffmpegVersion: "8.1.2",
      generation: 1,
      importId,
      manifestKey,
      mediaKey,
      mediaType: "video/mp4",
      observedAt: "2026-07-28T09:59:00.000Z",
      originalStreamsRemuxedToMp4: true,
      provenance: {
        canonicalUrl: "provider_observed",
        caption: null,
        creator: {
          displayName: null,
          handle: null,
          id: null,
        },
        publishedAt: null,
      },
      publishedAt: null,
      schemaVersion: 1,
      sha256: mediaSha256,
      videoStreams: [{ codec: "h264", index: 0 }],
      ytDlpVersion: "2026.07.04",
    })
  );
  const manifestSha256 = sha256Hex(manifest);
  await bucket.put(manifestKey, manifest, {
    customMetadata: objectMetadata("manifest", manifestSha256),
    httpMetadata: {
      cacheControl: "private, no-store",
      contentType: "application/json",
    },
    sha256: sha256Bytes(manifestSha256),
  });
  return mediaSha256;
};

const seedInterruptedSpeechDispatch = async (
  importId: string,
  mediaSha256: string
) => {
  if (runtime === undefined) {
    throw new Error("Miniflare runtime is not initialized");
  }
  const database = await runtime.getD1Database("MealPlannerDatabase");
  await database.batch([
    database
      .prepare(
        `UPDATE recipe_imports
            SET status = 'acquired',
                evidence_references_json = ?,
                updated_at = ?
          WHERE id = ? AND status = 'acquiring'`
      )
      .bind(
        JSON.stringify([
          {
            kind: "original_media",
            referenceId: `imports/${importId}/acquisition/v1/generations/1/original.mp4`,
          },
          {
            kind: "acquisition_manifest",
            referenceId: `imports/${importId}/acquisition/v1/generations/1/manifest.json`,
          },
        ]),
        "2026-07-28T10:00:30.000Z",
        importId
      ),
    database
      .prepare(
        `INSERT INTO import_transcriptions (
           import_id, acquisition_generation, dispatch_id,
           source_media_sha256, state, created_at, updated_at
         ) VALUES (?, 1, ?, ?, 'dispatching', ?, ?)`
      )
      .bind(
        importId,
        `speech:${importId}:1`,
        mediaSha256,
        "2026-07-28T10:00:30.000Z",
        "2026-07-28T10:00:30.000Z"
      ),
  ]);
};

describe("native post-acquisition Workflow replay", () => {
  it("persists a typed speech checkpoint without replaying acquisition or dispatching", async () => {
    const id = "gaia-192-post-acquisition-replay";
    const importId = "00000000-0000-4000-8000-000000000192";
    if (runtime === undefined) {
      throw new Error("Miniflare runtime is not initialized");
    }
    await runtime.setOptions(runtimeOptions(legacyFixtureScript));
    await seedAcquiringImport(importId);

    await expect(commandWorkflow({ id, importId })).resolves.toMatchObject({
      status: "errored",
    });
    const mediaSha256 = await seedVerifiedAcquisitionEvidence(importId);
    await seedInterruptedSpeechDispatch(importId, mediaSha256);

    if (runtime === undefined) {
      throw new Error("Miniflare runtime is not initialized");
    }
    await runtime.setOptions(runtimeOptions(correctedFixtureScript));

    const legacyRestart = await commandWorkflowRaw({
      action: "restart-legacy",
      id,
    });
    const legacyRestartBody = await legacyRestart.text();
    expect(legacyRestart.status).toBe(500);
    expect(legacyRestartBody).toContain(
      'Step "transcribe-video-v1" not found in execution history'
    );

    const status = await commandWorkflow({ action: "restart", id });
    const counters = await commandWorkflow({ action: "read", id });
    expect(status, JSON.stringify(status)).toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    expect(counters).toEqual({
      acquisitionCalls: 0,
      afterAcquisition: 1,
      afterClaim: 1,
      afterRecord: 1,
      audioCalls: 0,
      beforeClaim: 1,
      dispatchIdentityCalls: 1,
      providerCalls: 0,
      recipeFactory: 1,
      speechFactory: 1,
      visualFactory: 1,
    });
  }, 30_000);

  it("continues a two-step journal without replaying acquisition", async () => {
    const id = "gaia-194-truncated-post-acquisition-replay";
    const importId = "00000000-0000-4000-8000-000000000194";
    if (runtime === undefined) {
      throw new Error("Miniflare runtime is not initialized");
    }
    await runtime.setOptions(runtimeOptions(legacyFixtureScript));
    await seedAcquiringImport(importId, "7520000000000000194");

    await expect(commandWorkflow({ id, importId })).resolves.toMatchObject({
      status: "errored",
    });
    const mediaSha256 = await seedVerifiedAcquisitionEvidence(
      importId,
      "7520000000000000194"
    );
    await seedInterruptedSpeechDispatch(importId, mediaSha256);

    await runtime.setOptions(runtimeOptions(correctedFixtureScript));

    const oldRestart = await commandWorkflowRaw({ action: "restart", id });
    const oldRestartBody = await oldRestart.text();
    expect(oldRestart.status).toBe(500);
    expect(oldRestartBody).toContain(
      'Step "record-acquisition-v2" not found in execution history'
    );

    const truncatedStatus = await commandWorkflow({
      action: "restart-truncated",
      id,
    });
    const truncatedCounters = await commandWorkflow({ action: "read", id });
    expect(
      truncatedStatus,
      JSON.stringify({ truncatedCounters, truncatedStatus })
    ).toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    expect(truncatedCounters).toEqual({
      acquisitionCalls: 0,
      afterAcquisition: 1,
      afterClaim: 1,
      afterRecord: 1,
      audioCalls: 0,
      beforeClaim: 1,
      dispatchIdentityCalls: 1,
      providerCalls: 0,
      recipeFactory: 1,
      speechFactory: 1,
      visualFactory: 1,
    });

    const repeatedStatus = await commandWorkflow({
      action: "restart-truncated",
      id,
    });
    const repeatedCounters = await commandWorkflow({ action: "read", id });
    expect(repeatedStatus).toMatchObject({
      output: {
        _tag: "Failed",
        code: "outcome_unknown",
        stage: "speech",
      },
      status: "complete",
    });
    expect(repeatedCounters).toEqual({
      acquisitionCalls: 0,
      afterAcquisition: 2,
      afterClaim: 2,
      afterRecord: 2,
      audioCalls: 0,
      beforeClaim: 2,
      dispatchIdentityCalls: 2,
      providerCalls: 0,
      recipeFactory: 2,
      speechFactory: 2,
      visualFactory: 2,
    });
  }, 30_000);

  it("fails closed when a two-step journal has no retained evidence", async () => {
    const id = "gaia-194-truncated-missing-evidence";
    const importId = "00000000-0000-4000-8000-000000000195";
    if (runtime === undefined) {
      throw new Error("Miniflare runtime is not initialized");
    }
    await runtime.setOptions(runtimeOptions(legacyFixtureScript));
    await seedAcquiringImport(importId, "7520000000000000195");

    await expect(commandWorkflow({ id, importId })).resolves.toMatchObject({
      status: "errored",
    });
    await seedInterruptedSpeechDispatch(importId, "0".repeat(64));

    await runtime.setOptions(runtimeOptions(correctedFixtureScript));

    const status = await commandWorkflow({
      action: "restart-truncated",
      id,
    });
    const counters = await commandWorkflow({ action: "read", id });
    expect(status).toMatchObject({
      output: {
        _tag: "AcquisitionCheckpointRejected",
        code: "historical_acquisition_checkpoint_invalid",
      },
      status: "complete",
    });
    expect(counters).toEqual({
      acquisitionCalls: 0,
      afterAcquisition: 1,
      afterClaim: 1,
      afterRecord: 0,
      audioCalls: 0,
      beforeClaim: 1,
      dispatchIdentityCalls: 0,
      providerCalls: 0,
      recipeFactory: 1,
      speechFactory: 1,
      visualFactory: 1,
    });
  }, 30_000);
});
