import type {
  WorkerTestD1Database,
  WorkerTestMigration,
  WorkerTestR2Bucket,
} from "./features/imports/import-worker-test-environment.js";

declare global {
  namespace Cloudflare {
    interface Env {
      readonly ImportEvidenceBucket: WorkerTestR2Bucket;
      readonly MealPlannerDatabase: WorkerTestD1Database;
      readonly TEST_MIGRATIONS: readonly WorkerTestMigration[];
    }
  }
}
