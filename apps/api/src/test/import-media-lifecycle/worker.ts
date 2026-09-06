import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import type { BaseRuntimeContext } from "alchemy/RuntimeContext";
import { Self } from "alchemy/Self";
import { DurableObject } from "cloudflare:workers";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Schema,
  Stream,
} from "effect";

import { persistDerivedProviderEvidence } from "../../features/imports/import-derived-media.js";
import { acquireStoreVerify } from "../../features/imports/import-media-acquirer.js";
import { adaptAcquisitionBucket } from "../../features/imports/import-media-acquisition-bucket.alchemy.js";
import { makeAcquisitionMediaObject } from "../../features/imports/import-media-acquisition-object.client.js";
import type { AcquisitionMediaObjectStub } from "../../features/imports/import-media-acquisition-object.client.js";
import { ImportMediaAcquisitionObjectRuntime } from "../../features/imports/import-media-acquisition-object.js";
import { AcquisitionReaderHeader } from "../../features/imports/import-media-artifact-transport.js";
import {
  AcquisitionGeneration,
  acquisitionArtifactId,
  acquisitionCoordinatorId,
} from "../../features/imports/import-media.model.js";
import type { WorkerTestR2Bucket } from "../../features/imports/import-worker-test-environment.js";
import {
  ImportId,
  SourceCanonicalId,
} from "../../features/imports/import.contracts.js";

const workerResource = { bind: () => () => Effect.void };
// Only deployment registration metadata is synthetic. Runtime lifecycle, RPC,
// streams and storage use the production constructor and installed native bridge.
const services = Context.empty().pipe(
  Context.add(Self("Cloudflare.Container<TikTokMediaContainer>"), {
    LogicalId: "TikTokMediaContainer",
    bind: () => () => Effect.void,
    hash: Output.asOutput({ image: "native-test" }),
  } as never),
  Context.add(Self("Cloudflare.Worker"), workerResource as never),
  Context.add(Cloudflare.DurableObjectScope, {
    name: "ImportMediaAcquisitionObject",
    namespaceId: Output.asOutput("native-test"),
  } as never)
);
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      ImportMediaAcquisitionObject: {
        constructor: ImportMediaAcquisitionObjectRuntime,
        services,
      },
    }),
    shape: () => ({}),
  },
});
export class ImportMediaAcquisitionObject extends Cloudflare.makeDurableObjectBridge(
  DurableObject,
  {
    entrypoint,
    stack: { name: "MealPlanner", stage: "native-lifecycle-test" },
  }
)("ImportMediaAcquisitionObject") {
  async inspect() {
    return {
      retired: (await this["ctx"].storage.get("acquisitionRetired")) === true,
      running: this["ctx"].container?.running ?? false,
    };
  }
}
interface NativeAcquisition {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly inspect: () => Promise<{ running: boolean; retired: boolean }>;
}
interface Environment {
  ImportMediaAcquisitionObject: {
    readonly getByName: (name: string) => NativeAcquisition;
  };
  ImportEvidenceBucket: WorkerTestR2Bucket;
}
const runtimeContext: BaseRuntimeContext = {
  Type: "native-lifecycle-test",
  env: {},
  get: () => Effect.die("No runtime configuration is needed"),
  id: "native-lifecycle-test",
  set: () => Effect.die("No runtime configuration is needed"),
};
export default {
  async fetch(request: Request, env: Environment) {
    const url = new URL(request.url);
    const importId = Schema.decodeUnknownSync(ImportId)(
      "018f47ad-91aa-7c35-b6fe-000000000001"
    );
    const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(
      Number(url.searchParams.get("generation") ?? 1)
    );
    const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
      "7520000000000000000"
    );
    const native = env.ImportMediaAcquisitionObject.getByName(
      acquisitionCoordinatorId(importId, generation)
    );
    const stub = Cloudflare.makeRpcStub<AcquisitionMediaObjectStub>(native);
    const media = makeAcquisitionMediaObject(stub);
    if (url.pathname === "/inspect") {
      return Response.json(await native.inspect());
    }
    if (url.pathname === "/reader-open") {
      const response = await native.fetch(
        new Request(
          `http://container/artifacts/${encodeURIComponent(acquisitionArtifactId(importId, generation))}`,
          {
            headers: {
              [AcquisitionReaderHeader]: url.searchParams.get("reader") ?? "",
            },
          }
        )
      );
      await response.body?.cancel();
      return Response.json({ status: response.status });
    }
    const operation = Effect.gen(function* operation() {
      if (url.pathname === "/reader-close") {
        yield* stub.closeReader(
          acquisitionArtifactId(importId, generation),
          url.searchParams.get("reader") ?? ""
        );
        return yield* Effect.promise(() => native.inspect());
      }
      if (url.pathname === "/prepare") {
        return yield* media.prepare({
          canonicalId,
          generation,
          importId,
          kind: "tiktok",
        });
      }
      if (url.pathname === "/cleanup") {
        yield* Effect.logInfo("Consumer closed; requesting generation cleanup");
        yield* media.cleanup(acquisitionArtifactId(importId, generation));
        return yield* Effect.promise(() => native.inspect());
      }
      if (url.pathname === "/cancel") {
        const original = acquisitionArtifactId(importId, generation);
        yield* media.prepareProviderEvidence(original, 30);
        for (const artifact of [
          original,
          `${original}:audio`,
          `${original}:frame:0`,
          `${original}:frame:1`,
          `${original}:frame:2`,
        ]) {
          yield* media
            .readArtifact(artifact)
            .pipe(Stream.take(1), Stream.runDrain);
        }
        yield* Effect.logInfo("Consumer closed; requesting generation cleanup");
        yield* media.cleanup(acquisitionArtifactId(importId, generation));
        return yield* Effect.promise(() => native.inspect());
      }
      if (url.pathname === "/drain") {
        const first = yield* Deferred.make<true>();
        let bytes = 0;
        const read = yield* media
          .readArtifact(acquisitionArtifactId(importId, generation))
          .pipe(
            Stream.tap((chunk) =>
              Effect.sync(() => {
                bytes += chunk.length;
              }).pipe(Effect.andThen(Deferred.succeed(first, true)))
            ),
            Stream.runDrain,
            Effect.forkChild
          );
        yield* Deferred.await(first);
        const cleanup = yield* media
          .cleanup(acquisitionArtifactId(importId, generation))
          .pipe(Effect.forkChild);
        yield* Effect.sleep(200);
        const duringDrain = yield* Effect.promise(() => native.inspect());
        yield* Fiber.join(read);
        yield* Fiber.join(cleanup);
        return {
          afterDrain: yield* Effect.promise(() => native.inspect()),
          bytes,
          duringDrain,
        };
      }
      const client = yield* Cloudflare.R2.ReadWriteBucket;
      const bucketClient = yield* client({
        LogicalId: "ImportEvidenceBucket",
      } as never);
      const actualBucket = adaptAcquisitionBucket(bucketClient, runtimeContext);
      const bucket = {
        ...actualBucket,
        put: (...args: Parameters<typeof actualBucket.put>) =>
          actualBucket
            .put(...args)
            .pipe(Effect.tap(() => Effect.logInfo(`Stored ${args[0]}`))),
      };
      if (url.pathname === "/duplicate") {
        const bytes = new Uint8Array(2 * 1024 * 1024).fill(78);
        return yield* bucket.put(
          `imports/${importId}/acquisition/v1/generations/1/original.mp4`,
          Stream.succeed(bytes),
          {
            contentLength: bytes.length,
            customMetadata: { attempt: "must-not-replace" },
            httpMetadata: {
              cacheControl: "private, no-store",
              contentType: "video/mp4",
            },
            onlyIf: { etagDoesNotMatch: "*" },
            sha256: yield* Effect.promise(() =>
              crypto.subtle.digest("SHA-256", bytes)
            ),
          }
        );
      }
      yield* Effect.logInfo(
        `Starting ${url.pathname} generation ${generation}`
      );
      let beforeRelease;
      const result = yield* acquireStoreVerify(bucket, media, {
        beforeCleanup: (prepared) =>
          persistDerivedProviderEvidence(bucket, media, prepared, {
            generation,
            importId,
          }).pipe(
            Effect.andThen(
              Effect.promise(async () => {
                const stored = await env.ImportEvidenceBucket.list({
                  prefix: "imports/",
                });
                beforeRelease = {
                  ...(await native.inspect()),
                  objects: stored.objects.map(({ key }) => key),
                };
              })
            )
          ),
        canonicalId,
        generation,
        importId,
      });
      return {
        afterRelease: yield* Effect.promise(() => native.inspect()),
        beforeRelease,
        result,
      };
    }).pipe(
      Effect.scoped,
      Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
      Effect.provideService(Cloudflare.WorkerEnvironment, env),
      Effect.provide(services as unknown as Context.Context<Cloudflare.Worker>)
    );
    const exit = await Effect.runPromiseExit(operation);
    return Exit.isSuccess(exit)
      ? Response.json(exit.value)
      : Response.json({ failure: Cause.pretty(exit.cause) }, { status: 500 });
  },
};
