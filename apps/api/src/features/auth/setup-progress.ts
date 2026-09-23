import {
  canReplaceSetupProgress,
  HouseholdPersonMutationId,
  SetupProgress,
  SetupProgressVersion,
  sameSetupProgress,
  UserId,
} from "@meal-planner/household-api";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Schema } from "effect";

import { user } from "./auth.database-schema.js";

const SaveSetupProgressBody = Schema.toStandardSchemaV1(
  Schema.Struct({
    expectedVersion: SetupProgressVersion.pipe(
      Schema.check(Schema.isLessThan(Number.MAX_SAFE_INTEGER))
    ),
    progress: SetupProgress,
    sourceCommandId: Schema.optional(HouseholdPersonMutationId),
  }),
  { parseOptions: { onExcessProperty: "error" } }
);
const parseUserId = Schema.decodeUnknownSync(UserId);
const parseStoredProgress = Schema.decodeUnknownSync(SetupProgress);

/** One guarded SQL update owns the account checkpoint and its version. */
export const setupProgressPlugin = (getDatabase: () => DrizzleD1Database) =>
  ({
    endpoints: {
      saveSetupProgress: createAuthEndpoint(
        "/setup/progress",
        {
          body: SaveSetupProgressBody,
          method: "POST",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          ctx.setHeader("cache-control", "no-store");
          const accountId = parseUserId(ctx.context.session.user.id);
          const { expectedVersion, progress, sourceCommandId } = ctx.body;
          const database = getDatabase();
          const [observed] = await database
            .select({
              progress: user.setupProgress,
              version: user.setupProgressVersion,
            })
            .from(user)
            .where(eq(user.id, accountId));
          if (
            observed === undefined ||
            (observed.version === expectedVersion &&
              observed.progress !== null &&
              !canReplaceSetupProgress(
                parseStoredProgress(observed.progress),
                progress,
                sourceCommandId
              ))
          ) {
            throw new APIError("CONFLICT", {
              code: "SETUP_PROGRESS_CONFLICT",
              message:
                "Finish the saved setup request before starting another.",
            });
          }
          // Better Auth's adapter has no compare-and-swap operation. D1 must own
          // the version predicate and update in the same statement.
          const [saved] = await database
            .update(user)
            .set({
              setupProgress: progress,
              setupProgressVersion: expectedVersion + 1,
            })
            .where(
              and(
                eq(user.id, accountId),
                eq(user.setupProgressVersion, expectedVersion)
              )
            )
            .returning({
              progress: user.setupProgress,
              version: user.setupProgressVersion,
            });
          if (saved !== undefined) {
            return ctx.json({ progress, version: saved.version });
          }
          const [current] = await database
            .select({
              progress: user.setupProgress,
              version: user.setupProgressVersion,
            })
            .from(user)
            .where(eq(user.id, accountId));
          // A lost success response can be retried once against the exact write.
          if (
            current !== undefined &&
            current.version === expectedVersion + 1 &&
            current.progress !== null &&
            sameSetupProgress(parseStoredProgress(current.progress), progress)
          ) {
            return ctx.json({ progress, version: current.version });
          }
          throw new APIError("CONFLICT", {
            code: "SETUP_PROGRESS_CONFLICT",
            message: "Setup changed in another tab. Reload to continue.",
          });
        }
      ),
    },
    id: "setup-progress",
  }) satisfies BetterAuthPlugin;
