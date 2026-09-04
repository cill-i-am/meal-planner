import { Effect, Stream } from "effect";
import type { Miniflare } from "miniflare";

import type { AcquisitionPutValue } from "./import-media-acquirer.js";
import type { RetryableAcquisitionFailure } from "./import-media.model.js";

/** The D1 binding returned by Miniflare's public test API. */
export type WorkerTestD1Database = Awaited<
  ReturnType<Miniflare["getD1Database"]>
>;

/** The R2 binding returned by Miniflare's public test API. */
export type WorkerTestR2Bucket = Awaited<ReturnType<Miniflare["getR2Bucket"]>>;

/** Metadata returned by a Miniflare R2 head request. */
export type WorkerTestR2Object = Exclude<
  Awaited<ReturnType<WorkerTestR2Bucket["head"]>>,
  null
>;

/** Object body returned by a Miniflare R2 get request. */
export type WorkerTestR2ObjectBody = Exclude<
  Awaited<ReturnType<WorkerTestR2Bucket["get"]>>,
  null
>;

/** One decoded D1 migration supplied by the Worker test harness. */
export interface WorkerTestMigration {
  readonly name: string;
  readonly queries: readonly string[];
}

/** Decoded D1 bindings supplied to import Worker tests. */
export interface ImportWorkerTestEnvironment {
  readonly ProviderAccountingDatabase: WorkerTestD1Database;
  readonly TEST_MIGRATIONS: readonly WorkerTestMigration[];
}

/** Decoded D1 and R2 bindings supplied to import Worker tests. */
export interface ImportWorkerR2TestEnvironment extends ImportWorkerTestEnvironment {
  readonly ImportEvidenceBucket: WorkerTestR2Bucket;
}

/** Materialize an acquisition port value into a Miniflare-compatible R2 body. */
export const workerTestR2PutBody = (
  value: AcquisitionPutValue,
  contentLength: number
): Effect.Effect<ArrayBufferView, RetryableAcquisitionFailure> => {
  if (ArrayBuffer.isView(value)) {
    return Effect.succeed(value);
  }
  return Effect.gen(function* collectWorkerTestR2Body() {
    const chunks = yield* Stream.runCollect(value);
    const bytes = new Uint8Array(contentLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  });
};
