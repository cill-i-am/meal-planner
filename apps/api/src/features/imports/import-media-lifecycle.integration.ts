import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import * as Bundle from "alchemy/Bundle";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";

const run = promisify(execFile);
const enabled = process.env["MEAL_PLANNER_RUN_CONTAINER_TESTS"] === "1";
// The native Docker engine requires its configured networking image to exist locally.
const containerEgressInterceptorImage =
  "cloudflare/proxy-everything:3cb1195@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8";
const docker = async (...args: string[]) => {
  const result = await run("docker", args, { maxBuffer: 16 * 1024 * 1024 });
  return result.stdout.trim();
};

describe.skipIf(!enabled)("native generation container lifetime", () => {
  it("stores five real streamed bodies in native R2 before destroy and expires an abandoned generation", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const workerName = `media-lifecycle-${suffix}`;
    const image = `meal-planner-media-lifecycle:${suffix}`;
    const root = await mkdtemp(
      path.join(tmpdir(), "meal-planner-media-lifecycle-")
    );
    const fixtureRoot = path.resolve(
      import.meta.dirname,
      "../../test/import-media-lifecycle"
    );
    const nodeBundle = await Effect.runPromise(
      Bundle.build(
        {
          checks: { unresolvedImport: false },
          input: path.join(fixtureRoot, "container.ts"),
          platform: "node",
        },
        {
          codeSplitting: false,
          dir: root,
          format: "esm",
          minify: true,
          sourcemap: false,
        }
      )
    );
    const [entry] = nodeBundle.files;
    if (entry === undefined) {
      throw new Error("No container bundle");
    }
    await writeFile(path.join(root, "container.mjs"), entry.content);
    await writeFile(
      path.join(root, "Dockerfile"),
      `FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e\nCOPY container.mjs /container.mjs\nCMD ["node", "/container.mjs"]\n`
    );
    const manifest = await bundleWorkerFixture(
      path.join(fixtureRoot, "worker.ts"),
      path.join(root, "worker")
    );
    const context = JSON.parse(await docker("context", "inspect"));
    const socketPath = String(context[0].Endpoints.docker.Host);
    await docker("build", "--platform", "linux/amd64", "-t", image, root);
    await docker("pull", containerEgressInterceptorImage);
    const mf = new Miniflare({
      cf: false,
      containerEngine: {
        localDocker: { containerEgressInterceptorImage, socketPath },
      },
      workers: [
        {
          config: {
            compatibilityDate: "2026-07-14",
            compatibilityFlags: ["nodejs_compat"],
            env: {
              ImportEvidenceBucket: {
                name: "ImportEvidenceBucket",
                type: "r2",
              },
              ImportMediaAcquisitionObject: {
                exportName: "ImportMediaAcquisitionObject",
                type: "durable-object",
                worker: workerName,
              },
            },
            exports: {
              ImportMediaAcquisitionObject: {
                container: { imageName: image },
                storage: "sqlite",
                type: "durable-object",
              },
            },
            manifest,
            name: workerName,
            type: "worker",
          },
        },
      ],
    });
    const call = async (route: string, expectedStatus = 200) => {
      const response = await mf.dispatchFetch(`http://lifecycle${route}`);
      const body = await response.text();

      expect(response.status, body).toBe(expectedStatus);
      return JSON.parse(body);
    };
    const processes = async () => {
      const ids = await docker(
        "ps",
        "--filter",
        `ancestor=${image}`,
        "--format",
        "{{.ID}}"
      );
      return ids.split("\n").filter(Boolean);
    };
    try {
      await mf.ready;
      const abandoned = await call("/prepare?generation=2");
      expect(abandoned.artifactId).toBeDefined();
      const abandonedStart = Date.now();
      const [abandonedId] = await processes();
      expect(abandonedId).toBeDefined();
      const acquisition = call("/acquire");
      await delay(3000);
      expect(await call("/inspect")).toMatchObject({ running: true });
      expect(await processes()).toHaveLength(2);
      const result = await acquisition;
      expect(result.result._tag).toBe("VerifiedAcquisition");
      expect(result.beforeRelease.running).toBe(true);
      expect(result.beforeRelease.retired).toBe(false);
      expect(result.beforeRelease.objects).toHaveLength(6);
      expect(result.afterRelease).toEqual({ retired: true, running: false });
      expect(await processes()).toEqual([abandonedId]);
      console.log(
        JSON.stringify({
          phase: "verified-native-r2-before-release",
          ...result.beforeRelease,
          afterRelease: result.afterRelease,
        })
      );
      const r2 = await mf.getR2Bucket("ImportEvidenceBucket");
      const stored = await r2.list({ prefix: "imports/" });
      expect(stored.objects).toHaveLength(7);
      await Promise.all(
        stored.objects
          .filter(({ key }) => !key.endsWith(".json"))
          .map(async (object) => {
            const body = await r2.get(object.key);
            if (body === null) {
              throw new Error(`Missing streamed object ${object.key}`);
            }
            const bytes = new Uint8Array(await body.arrayBuffer());
            expect(bytes.length).toBe(2 * 1024 * 1024);
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(
              "34af56de4c2b7216ce832be471c791eb350248683cb91924eefdcfc67738f296"
            );
          })
      );
      const original = stored.objects.find(({ key }) =>
        key.endsWith("original.mp4")
      );
      if (original === undefined) {
        throw new Error("Missing original artifact");
      }
      const originalKey = original.key;
      const originalHead = await r2.head(originalKey);
      expect(await call("/duplicate")).toBeNull();
      expect(await r2.head(originalKey)).toEqual(originalHead);
      const retained = await r2.get(originalKey);
      if (retained === null) {
        throw new Error("Original disappeared after conditional put");
      }
      expect(
        createHash("sha256")
          .update(new Uint8Array(await retained.arrayBuffer()))
          .digest("hex")
      ).toBe(
        "34af56de4c2b7216ce832be471c791eb350248683cb91924eefdcfc67738f296"
      );
      await call("/prepare", 500);
      await call("/cleanup");
      expect(await processes()).toEqual([abandonedId]);
      expect(await call("/inspect?generation=2")).toMatchObject({
        running: true,
      });
      await call("/prepare?generation=3");
      expect(await call("/cancel?generation=3")).toEqual({
        retired: true,
        running: false,
      });
      expect(await processes()).toEqual([abandonedId]);
      console.log(
        JSON.stringify({
          generation: 3,
          phase: "cancelled-reader-destroy-before-teardown",
        })
      );
      await call("/prepare?generation=4");
      const drain = await call("/drain?generation=4");
      expect(drain).toEqual({
        afterDrain: { retired: true, running: false },
        bytes: 2 * 1024 * 1024,
        duringDrain: { retired: true, running: true },
      });
      expect(await processes()).toEqual([abandonedId]);
      await mf.unsafeEvictDurableObject(
        workerName,
        "ImportMediaAcquisitionObject",
        {
          name: "018f47ad-91aa-7c35-b6fe-000000000001:acquisition-generation:1",
        }
      );
      expect(await call("/inspect")).toEqual({ retired: true, running: false });
      await call("/prepare", 500);
      expect(await processes()).toEqual([abandonedId]);
      const closedReader = randomUUID();
      expect(
        await call(`/reader-close?generation=5&reader=${closedReader}`)
      ).toEqual({ retired: false, running: false });
      await mf.unsafeEvictDurableObject(
        workerName,
        "ImportMediaAcquisitionObject",
        {
          name: "018f47ad-91aa-7c35-b6fe-000000000001:acquisition-generation:5",
        }
      );
      expect(
        await call(`/reader-open?generation=5&reader=${closedReader}`)
      ).toEqual({ status: 500 });
      expect(await processes()).toEqual([abandonedId]);
      await call("/prepare?generation=5");
      expect(await processes()).toHaveLength(2);
      console.log(
        JSON.stringify({
          closedReaderReplayRejected: true,
          drain,
          phase: "native-drain-and-reconstruction",
        })
      );
      await expect
        .poll(
          async () => {
            const [state, reconstructed] = await Promise.all([
              call("/inspect?generation=2"),
              call("/inspect?generation=5"),
            ]);
            return (
              state.retired &&
              !state.running &&
              reconstructed.retired &&
              !reconstructed.running
            );
          },
          { interval: 15_000, timeout: 400_000 }
        )
        .toBe(true);
      expect(await call("/inspect?generation=2")).toEqual({
        retired: true,
        running: false,
      });
      expect(await call("/inspect?generation=5")).toEqual({
        retired: true,
        running: false,
      });
      expect(await processes()).toEqual([]);
      await call("/prepare?generation=2", 500);
      expect(await processes()).toEqual([]);
      console.log(
        JSON.stringify({
          dockerProcesses: await processes(),
          elapsedMilliseconds: Date.now() - abandonedStart,
          phase: "default-idle-alarm-destroy-before-teardown",
        })
      );
    } finally {
      console.log("Native lifecycle teardown begins after assertions");
      await mf.dispose();
      const leftoverIds = await docker(
        "ps",
        "-a",
        "--filter",
        `name=workerd-${workerName}-`,
        "--format",
        "{{.ID}}"
      );
      const leftovers = leftoverIds.split("\n").filter(Boolean);
      if (leftovers.length) {
        await docker("rm", "-f", ...leftovers);
      }
      await docker("image", "rm", image);
      await rm(root, { force: true, recursive: true });
    }
  });
});
