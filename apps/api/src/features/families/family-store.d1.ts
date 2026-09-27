import {
  FamilyFailure,
  FamilyStore,
  StoredFamily,
  familySlug,
  canManageFamily,
} from "@meal-planner/families/application";
import type { FamilyStoreShape } from "@meal-planner/families/application";
import type { UserId } from "@meal-planner/household-api";
import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { and, eq, exists, isNull, notExists, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Clock, Effect, Layer, Schema } from "effect";

import { member, organization } from "../auth/schema.js";
import { familyRecord, familyRenameReceipt } from "./schema.js";

const failure = (reason: FamilyFailure["reason"]) =>
  new FamilyFailure({ reason });

const decode = Schema.decodeUnknownEffect(StoredFamily);
const databaseEffect = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: () => failure("unavailable"), try: run });

/** D1 owns the organization/owner commit; household creator linking is a separate write. */
export const FamilyStoreLive = (database: DrizzleD1Database) =>
  Layer.effect(
    FamilyStore,
    Effect.sync(() => {
      const query = (actor: UserId) =>
        database
          .select({
            completedAt: familyRecord.completedAt,
            createdAt: organization.createdAt,
            creationMutationId: familyRecord.creationMutationId,
            creationName: familyRecord.creationName,
            creatorDisplayName: familyRecord.creatorDisplayName,
            creatorLinked: familyRecord.creatorLinked,
            creatorUserId: familyRecord.creatorUserId,
            id: organization.id,
            name: organization.name,
            role: member.role,
            slug: organization.slug,
            updatedAt: familyRecord.updatedAt,
            version: familyRecord.version,
          })
          .from(familyRecord)
          .innerJoin(
            organization,
            eq(organization.id, familyRecord.organizationId)
          )
          .innerJoin(
            member,
            and(
              eq(member.organizationId, organization.id),
              eq(member.userId, actor)
            )
          );
      type Row = Awaited<ReturnType<typeof query>>[number];
      const parse = (row: Row) =>
        decode({
          ...row,
          family: {
            canManage: canManageFamily(row.role),
            createdAtEpochMs: row.createdAt.getTime(),
            id: row.id,
            name: row.name,
            setup:
              row.completedAt === null
                ? { status: "in_progress" }
                : {
                    completedAtEpochMs: row.completedAt.getTime(),
                    status: "complete",
                  },
            slug: row.slug,
            updatedAtEpochMs: row.updatedAt.getTime(),
            version: row.version,
          },
        }).pipe(Effect.mapError(() => failure("unavailable")));
      const get: FamilyStoreShape["get"] = (actor, id) =>
        Effect.gen(function* readFamilyRecord() {
          const [row] = yield* databaseEffect(() =>
            query(actor).where(eq(organization.id, id))
          );
          if (!row) {
            return yield* Effect.fail(failure("not_found"));
          }
          return yield* parse(row);
        });
      const allowed = (actor: UserId, id: HouseholdOrganizationId) =>
        exists(
          database
            .select({ id: member.id })
            .from(member)
            .where(
              and(
                eq(member.organizationId, id),
                eq(member.userId, actor),
                eq(member.role, "owner")
              )
            )
        );
      return FamilyStore.of({
        complete: (actor, id) =>
          Effect.gen(function* completeFamilySetup() {
            const current = yield* get(actor, id);
            if (!canManageFamily(current.role)) {
              return yield* Effect.fail(failure("forbidden"));
            }
            if (!current.creatorLinked) {
              return yield* Effect.fail(failure("creation_incomplete"));
            }
            const now = new Date(yield* Clock.currentTimeMillis);
            yield* databaseEffect(() =>
              database
                .update(familyRecord)
                .set({
                  completedAt: now,
                  updatedAt: now,
                  version: sql`${familyRecord.version} + 1`,
                })
                .where(
                  and(
                    eq(familyRecord.organizationId, id),
                    isNull(familyRecord.completedAt),
                    allowed(actor, id)
                  )
                )
            );
            const saved = yield* get(actor, id);
            if (!canManageFamily(saved.role)) {
              return yield* Effect.fail(failure("forbidden"));
            }
            if (saved.family.setup.status !== "complete") {
              return yield* Effect.fail(failure("creation_incomplete"));
            }
            return saved.family;
          }),
        create: (actor, creatorName, input) =>
          Effect.gen(function* createFamilyRecord() {
            const digest = yield* databaseEffect(async () => {
              const bytes = await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(
                  JSON.stringify([actor, input.mutationId])
                )
              );
              return [...new Uint8Array(bytes)]
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
            });
            const id = yield* Schema.decodeUnknownEffect(
              HouseholdOrganizationId
            )(`family-${digest}`).pipe(
              Effect.mapError(() => failure("unavailable"))
            );
            const now = new Date(yield* Clock.currentTimeMillis);
            const base = familySlug(input.name);
            const absent = notExists(
              database
                .select({ id: familyRecord.organizationId })
                .from(familyRecord)
                .where(eq(familyRecord.organizationId, id))
            );
            const insert = (slug: string) =>
              databaseEffect(() =>
                database.batch([
                  database
                    .insert(organization)
                    .values({ createdAt: now, id, name: input.name, slug })
                    .onConflictDoNothing({ target: organization.id }),
                  database
                    .insert(member)
                    .select(
                      database
                        // eslint-disable-next-line sort-keys -- Drizzle INSERT SELECT must match the generated member column order.
                        .select({
                          id: sql<string>`${`${id}-owner`}`.as("id"),
                          organizationId: organization.id,
                          userId: sql<string>`${actor}`.as("user_id"),
                          role: sql<string>`'owner'`.as("role"),
                          createdAt: sql<Date>`${now.getTime()}`.as(
                            "created_at"
                          ),
                        })
                        .from(organization)
                        .where(and(eq(organization.id, id), absent))
                    )
                    .onConflictDoNothing(),
                  database
                    .insert(familyRecord)
                    .values({
                      creationMutationId: input.mutationId,
                      creationName: input.name,
                      creatorDisplayName: creatorName,
                      creatorUserId: actor,
                      organizationId: id,
                      updatedAt: now,
                    })
                    .onConflictDoNothing(),
                ])
              );
            // The unique slug index arbitrates concurrent families with the same name.
            yield* insert(base).pipe(
              Effect.catch((error) =>
                Effect.gen(function* chooseAvailableSlug() {
                  const [collision] = yield* databaseEffect(() =>
                    database
                      .select({ id: organization.id })
                      .from(organization)
                      .where(eq(organization.slug, base))
                  );
                  if (!collision || collision.id === id) {
                    return yield* Effect.fail(error);
                  }
                  return yield* insert(`${base}-${digest.slice(0, 16)}`);
                })
              )
            );
            const result = yield* get(actor, id);
            if (
              result.creationName !== input.name ||
              result.creationMutationId !== input.mutationId ||
              result.creatorUserId !== actor
            ) {
              return yield* Effect.fail(failure("mutation_collision"));
            }
            return result;
          }),
        creatorLinked: (id) =>
          databaseEffect(() =>
            database
              .update(familyRecord)
              .set({ creatorLinked: true })
              .where(eq(familyRecord.organizationId, id))
          ).pipe(Effect.asVoid),
        get,
        list: (actor) =>
          databaseEffect(() => query(actor)).pipe(
            Effect.flatMap((rows) =>
              Effect.all(
                rows.map((row) => parse(row).pipe(Effect.map((r) => r.family)))
              )
            )
          ),
        update: (actor, id, input) =>
          Effect.gen(function* renameFamilyRecord() {
            const current = yield* get(actor, id);
            if (!canManageFamily(current.role)) {
              return yield* Effect.fail(failure("forbidden"));
            }
            const receiptKey = and(
              eq(familyRenameReceipt.organizationId, id),
              eq(familyRenameReceipt.actorId, actor),
              eq(familyRenameReceipt.mutationId, input.mutationId)
            );
            const readReceipt = () =>
              databaseEffect(() =>
                database.select().from(familyRenameReceipt).where(receiptKey)
              );
            const [previous] = yield* readReceipt();
            const same = (r: typeof familyRenameReceipt.$inferSelect) =>
              r.expectedVersion === input.expectedVersion &&
              r.name === input.name;
            if (previous) {
              if (!same(previous)) {
                return yield* Effect.fail(failure("mutation_collision"));
              }
              return current.family;
            }
            if (current.family.version !== input.expectedVersion) {
              return yield* Effect.fail(failure("stale_version"));
            }
            const now = new Date(yield* Clock.currentTimeMillis);
            const matches = and(
              eq(familyRecord.organizationId, id),
              eq(familyRecord.version, input.expectedVersion),
              allowed(actor, id)
            );
            const receiptMatches = exists(
              database
                .select({ id: familyRenameReceipt.organizationId })
                .from(familyRenameReceipt)
                .where(
                  and(
                    receiptKey,
                    eq(
                      familyRenameReceipt.expectedVersion,
                      input.expectedVersion
                    ),
                    eq(familyRenameReceipt.name, input.name)
                  )
                )
            );
            yield* databaseEffect(() =>
              database.batch([
                database
                  .insert(familyRenameReceipt)
                  .select(
                    database
                      .select({
                        actorId: sql<string>`${actor}`.as("actor_id"),
                        expectedVersion: familyRecord.version,
                        mutationId: sql<string>`${input.mutationId}`.as(
                          "mutation_id"
                        ),
                        name: sql<string>`${input.name}`.as("name"),
                        organizationId: familyRecord.organizationId,
                      })
                      .from(familyRecord)
                      .where(matches)
                  )
                  .onConflictDoNothing(),
                database
                  .update(organization)
                  .set({ name: input.name })
                  .where(
                    and(
                      eq(organization.id, id),
                      receiptMatches,
                      exists(
                        database
                          .select({ id: familyRecord.organizationId })
                          .from(familyRecord)
                          .where(matches)
                      )
                    )
                  ),
                database
                  .update(familyRecord)
                  .set({ updatedAt: now, version: input.expectedVersion + 1 })
                  .where(and(matches, receiptMatches)),
              ])
            );
            const [savedReceipt] = yield* readReceipt();
            if (!savedReceipt) {
              return yield* Effect.fail(failure("stale_version"));
            }
            if (!same(savedReceipt)) {
              return yield* Effect.fail(failure("mutation_collision"));
            }
            return (yield* get(actor, id)).family;
          }),
      });
    })
  );
