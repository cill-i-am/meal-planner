import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { UserId } from "@meal-planner/household-api";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";
import type { PrivateOutputMutationPort } from "../private-output/private-output-binding.js";
import {
  makeAuthOutputFence,
  runOutputFencedMutation,
} from "../private-output/private-output-mutation.js";
import { privateOutputRuntimeWorker } from "../private-output/private-output-runtime.test-fixture.js";
import { privateOutputKey } from "../private-output/private-output.contract.js";
import {
  AcceptInvitationMutation,
  ResetPasswordMutation,
  makeAuthAtomicStore,
} from "./auth-atomic-store.js";
import * as schema from "./auth.database-schema.js";

let runtime: Miniflare;
let directory: string;
let database: ReturnType<typeof drizzle>;
beforeAll(async () => {
  directory = await mkdtemp(`${tmpdir()}/auth-atomic-fence-`);
  const manifest = await bundleWorkerFixture(
    fileURLToPath(
      new URL(
        "../private-output/private-output-control.test-fixture.ts",
        import.meta.url
      )
    ),
    directory
  );
  const worker = privateOutputRuntimeWorker(manifest);
  runtime = new Miniflare({
    cf: false,
    resourcePersistencePath: `${directory}/storage`,
    workers: [
      {
        config: {
          ...worker.config,
          env: {
            ...worker.config.env,
            AuthDatabase: { id: "auth-atomic-fence", type: "d1" },
          },
        },
      },
    ],
  });
  const d1 = await runtime.getD1Database("AuthDatabase", "private-output");
  const root = new URL("../../../auth-migrations/", import.meta.url);
  const names = await readdir(root);
  const migrations = await Promise.all(
    names
      .toSorted()
      .map((name) => readFile(new URL(`${name}/migration.sql`, root), "utf-8"))
  );
  await d1.batch(
    migrations
      .flatMap((migration) =>
        migration
          .split("--> statement-breakpoint")
          .map((statement) => statement.trim())
          .filter(Boolean)
      )
      .map((statement) => d1.prepare(statement))
  );
  database = drizzle(d1);
}, 60_000);
afterAll(async () => {
  await runtime?.dispose();
  if (directory) {
    await rm(directory, { force: true, recursive: true });
  }
});

const fixture = async () => {
  const userId = Schema.decodeUnknownSync(UserId)(crypto.randomUUID());
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3_600_000);
  await database.insert(schema.user).values({
    createdAt: now,
    email: `${userId}@example.test`,
    id: userId,
    name: "Synthetic recipient",
    updatedAt: now,
  });
  await database.insert(schema.session).values({
    createdAt: now,
    expiresAt,
    id: crypto.randomUUID(),
    token: userId,
    updatedAt: now,
    userId,
  });
  const command = async <A>(action: string, input: object): Promise<A> => {
    const response = await runtime.dispatchFetch(
      "https://atomic-fence.test/control",
      {
        headers: {
          "x-test-command": JSON.stringify({
            ...input,
            action,
            sessionReference: userId,
          }),
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Durable fence returned ${response.status}`);
    }
    return ((await response.json()) as { readonly result: A }).result;
  };
  let unavailableCompletion = false;
  let dispatches = 0;
  const port: PrivateOutputMutationPort = {
    beginMutation: (input) => command("mutation-begin", input),
    completeMutation: (input) => {
      if (unavailableCompletion) {
        throw new Error("Synthetic unavailable completion transport");
      }
      return command("mutation-complete", input);
    },
    findPendingMutation: (input) => command("mutation-find-pending", input),
    markDispatched: async (input) => {
      await command("mutation-dispatch", input);
      dispatches += 1;
    },
    prepareMutation: (input) => command("mutation-prepare", input),
    readMutation: (input) => command("mutation-read", input),
  };
  const store = makeAuthAtomicStore(() => database, makeAuthOutputFence(port));
  const key = await privateOutputKey("account", userId);
  const retained = (intentKey: string) =>
    port.beginMutation({ intentKey, key, scope: "account" });
  const phase = (operationId: string) =>
    port.readMutation({ key, operationId, scope: "account" });
  return {
    dispatches: () => dispatches,
    expiresAt,
    failCompletion: (value: boolean) => {
      unavailableCompletion = value;
    },
    key,
    now,
    phase,
    port,
    retained,
    store,
    userId,
  };
};
const resetFixture = async () => {
  const f = await fixture();
  const identifier = `reset-password:${crypto.randomUUID()}`;
  const verificationId = crypto.randomUUID();
  await database.insert(schema.account).values({
    accountId: f.userId,
    createdAt: f.now,
    id: f.userId,
    issuer: "local:credential",
    password: "synthetic-old-hash",
    providerId: "credential",
    updatedAt: f.now,
    userId: f.userId,
  });
  await database.insert(schema.verification).values({
    createdAt: f.now,
    expiresAt: f.expiresAt,
    id: verificationId,
    identifier,
    updatedAt: f.now,
    value: f.userId,
  });
  const input = Schema.decodeUnknownSync(ResetPasswordMutation)({
    accountId: f.userId,
    identifier,
    issuer: "local:credential",
    passwordHash: "synthetic-new-hash",
    requestPassword: "synthetic-new-password",
    userId: f.userId,
    verificationId,
  });
  return {
    ...f,
    input,
    intentKey: await privateOutputKey("auth-password-reset", identifier),
  };
};
describe("atomic auth against the durable output fence", () => {
  it("retries a rolled-back reset after durable dispatch and settles that exact operation", async () => {
    const f = await resetFixture();
    await database.run(
      sql`CREATE TRIGGER atomic_reset_failure BEFORE DELETE ON session WHEN OLD.user_id = ${f.userId} BEGIN SELECT RAISE(ABORT, 'synthetic reset rollback'); END`.inlineParams()
    );
    try {
      await expect(f.store.resetPassword(f.input)).rejects.toThrow();
    } finally {
      await database.run(sql`DROP TRIGGER atomic_reset_failure`);
    }
    const retained = await f.retained(f.intentKey);
    expect(retained.phase).toBe("dispatched");
    expect(
      await database
        .select()
        .from(schema.authMutationReceipt)
        .where(eq(schema.authMutationReceipt.id, f.intentKey))
    ).toEqual([]);
    expect(await f.store.resetPassword(f.input)).toBe(true);
    expect(await f.phase(retained.operationId)).toEqual({ phase: "settled" });
    expect(
      await database
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, f.userId))
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(schema.verification)
        .where(eq(schema.verification.id, f.input.verificationId))
    ).toEqual([]);
  });
  it("reconciles a committed reset after unavailable completion without applying the old proof again", async () => {
    const f = await resetFixture();
    f.failCompletion(true);
    await expect(f.store.resetPassword(f.input)).rejects.toThrow();
    const retained = await f.retained(f.intentKey);
    expect(retained.phase).toBe("dispatched");
    expect(
      await database
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, f.userId))
    ).toEqual([]);
    // A later login must survive reconciliation of this already-committed reset.
    await database.insert(schema.session).values({
      createdAt: f.now,
      expiresAt: f.expiresAt,
      id: crypto.randomUUID(),
      token: crypto.randomUUID(),
      updatedAt: f.now,
      userId: f.userId,
    });
    f.failCompletion(false);
    await f.store.reconcilePasswordReset(f.input.identifier);
    expect(await f.phase(retained.operationId)).toEqual({ phase: "settled" });
    const dispatches = f.dispatches();
    await f.store.reconcilePasswordReset(f.input.identifier);
    expect(f.dispatches()).toBe(dispatches);
    expect(
      await f.store.resetPassword({
        ...f.input,
        passwordHash: "different-hash",
        requestPassword: "different-password",
      })
    ).toBe(false);
    expect(
      await database
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, f.userId))
    ).toMatchObject([{ password: "synthetic-new-hash" }]);
    expect(
      await database
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, f.userId))
    ).toHaveLength(1);
  });
  it("retries rolled-back acceptance under its retained fence and cannot recreate removed membership", async () => {
    const f = await fixture();
    const ownerId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const invitationId = crypto.randomUUID();
    await database.insert(schema.user).values({
      createdAt: f.now,
      email: `${ownerId}@example.test`,
      id: ownerId,
      name: "Synthetic owner",
      updatedAt: f.now,
    });
    await database.insert(schema.organization).values({
      createdAt: f.now,
      id: organizationId,
      name: "Synthetic family",
      slug: organizationId,
    });
    await database.insert(schema.member).values({
      createdAt: f.now,
      id: ownerId,
      organizationId,
      role: "owner",
      userId: ownerId,
    });
    await database.insert(schema.invitation).values({
      createdAt: f.now,
      email: `${f.userId}@example.test`,
      expiresAt: f.expiresAt,
      id: invitationId,
      inviterId: ownerId,
      organizationId,
      role: "member",
      status: "pending",
    });
    const input = Schema.decodeUnknownSync(AcceptInvitationMutation)({
      email: `${f.userId}@example.test`,
      invitationId,
      memberId: crypto.randomUUID(),
      membershipLimit: 100,
      organizationId,
      sessionToken: f.userId,
      userId: f.userId,
    });
    const intentKey = await privateOutputKey(
      "auth-invitation-accept",
      JSON.stringify({ invitationId, userId: f.userId })
    );
    const membership = () =>
      database
        .select()
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, organizationId),
            eq(schema.member.userId, f.userId)
          )
        );
    await database.run(
      sql`CREATE TRIGGER atomic_acceptance_failure BEFORE UPDATE ON session WHEN OLD.user_id = ${f.userId} BEGIN SELECT RAISE(ABORT, 'synthetic invitation rollback'); END`.inlineParams()
    );
    try {
      await expect(f.store.acceptInvitation(input)).rejects.toThrow();
    } finally {
      await database.run(sql`DROP TRIGGER atomic_acceptance_failure`);
    }
    expect(await membership()).toEqual([]);
    const retained = await f.retained(intentKey);
    expect(retained.phase).toBe("dispatched");
    expect(await f.store.acceptInvitation(input)).toBe(true);
    expect(await f.phase(retained.operationId)).toEqual({ phase: "settled" });
    expect(await membership()).toHaveLength(1);
    await database
      .delete(schema.member)
      .where(eq(schema.member.id, input.memberId));
    await f.store.reconcileInvitation(input.invitationId, f.userId);
    await f.store.acceptInvitation(
      Schema.decodeUnknownSync(AcceptInvitationMutation)({
        ...input,
        memberId: crypto.randomUUID(),
      })
    );
    expect(await membership()).toEqual([]);
  });
  it("settles a rolled-back reset even after native cleanup removes its token, fencing delayed writes with a terminal receipt", async () => {
    const f = await resetFixture();
    await database.run(
      sql`CREATE TRIGGER abandoned_reset_failure BEFORE DELETE ON session WHEN OLD.user_id = ${f.userId} BEGIN SELECT RAISE(ABORT, 'synthetic reset rollback'); END`.inlineParams()
    );
    try {
      await expect(f.store.resetPassword(f.input)).rejects.toThrow();
    } finally {
      await database.run(sql`DROP TRIGGER abandoned_reset_failure`);
    }
    const retained = await f.retained(f.intentKey);
    expect(retained.phase).toBe("dispatched");
    await database
      .delete(schema.verification)
      .where(eq(schema.verification.id, f.input.verificationId));
    await f.store.reconcilePasswordReset(f.input.identifier);
    expect(await f.phase(retained.operationId)).toEqual({ phase: "settled" });
    expect(await f.store.resetPassword(f.input)).toBe(false);
    expect(
      await database
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, f.userId))
    ).toMatchObject([{ password: "synthetic-old-hash" }]);
    expect(
      await database
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, f.userId))
    ).toHaveLength(1);
  });

  it("continues to reject replay of ordinary mutations after dispatch", async () => {
    const f = await fixture();
    const input = {
      intentKey: await privateOutputKey("ordinary", f.userId),
      key: f.key,
      scope: "account" as const,
    };
    let calls = 0;
    const canonical = () => {
      calls += 1;
      return Promise.reject(new Error("Synthetic unknown result"));
    };
    await expect(
      runOutputFencedMutation(f.port, input, canonical)
    ).rejects.toThrow();
    await expect(
      runOutputFencedMutation(f.port, input, canonical)
    ).rejects.toMatchObject({ reason: "mutation_pending" });
    expect(calls).toBe(1);
  });
});
