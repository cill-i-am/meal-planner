import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { Effect, Schema } from "effect";
import type { ModuleDefinition } from "miniflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HouseholdDomainFailure,
  HouseholdMetadata,
} from "./household.contract.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const fixturePath = fileURLToPath(
  new URL("household-object-host.test-fixture.ts", import.meta.url)
);
const temporaryDirectories: string[] = [];
let runtime: Miniflare;

const HouseholdEnsureResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: HouseholdMetadata,
  }),
  Schema.Struct({
    error: HouseholdDomainFailure,
    ok: Schema.Literal(false),
  }),
]);

const bundleText = (content: string | Uint8Array<ArrayBufferLike>): string =>
  Schema.is(Schema.String)(content)
    ? content
    : new TextDecoder().decode(content);

const buildFixture = async (
  outputDirectory: string
): Promise<readonly [ModuleDefinition, ...ModuleDefinition[]]> => {
  const output = await Effect.runPromise(
    Bundle.build(
      {
        checks: {
          ineffectiveDynamicImport: false,
          unresolvedImport: false,
        },
        external: ["cloudflare:workers"],
        input: fixturePath,
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
  const [entry, ...assets] = output.files;
  return [
    {
      contents: bundleText(entry.content),
      path: entry.path,
      type: "ESModule",
    },
    ...assets.map(
      (asset): ModuleDefinition => ({
        contents: bundleText(asset.content),
        path: asset.path,
        type: "Text",
      })
    ),
  ];
};

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-household-object-`
  );
  temporaryDirectories.push(temporaryDirectory);
  const fixtureModules = await buildFixture(temporaryDirectory);
  runtime = new Miniflare({
    compatibilityDate,
    compatibilityFlags,
    durableObjects: {
      HouseholdObject: {
        className: "HouseholdObject",
        useSQLite: true,
      },
    },
    modules: [...fixtureModules],
  });
}, 30_000);

afterAll(async () => {
  await runtime.dispose();
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

const commandHousehold = async (objectName: string, organizationId: string) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({ objectName, organizationId }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(HouseholdEnsureResponse)(
    await response.json()
  );
};

const ensureHousehold = (objectName: string, organizationId: string) =>
  commandHousehold(objectName, organizationId);

describe("household Durable Object", () => {
  it("initializes once and rejects a conflicting organization provenance", async () => {
    const objectName = "household:v1:organization-a";
    const initial = await ensureHousehold(objectName, "organization-a");
    const replay = await ensureHousehold(objectName, "organization-a");

    expect(initial).toMatchObject({ ok: true });
    if (!initial.ok) {
      throw new Error("Expected household initialization to succeed.");
    }
    if (!Schema.is(HouseholdMetadata)(initial.value)) {
      throw new Error("Expected household metadata from initialization.");
    }
    expect(initial.value).toEqual({
      createdAtEpochMs: expect.any(Number),
      organizationId: "organization-a",
    });
    expect(replay).toEqual(initial);

    const mismatch = await ensureHousehold(objectName, "organization-b");
    expect(mismatch).toMatchObject({ ok: false });
    if (mismatch.ok) {
      throw new Error("Expected conflicting household provenance to fail.");
    }
    expect(mismatch.error).toMatchObject({
      _tag: "HouseholdProvenanceMismatch",
      organizationId: "organization-b",
      persistedOrganizationId: "organization-a",
    });
  });
});
