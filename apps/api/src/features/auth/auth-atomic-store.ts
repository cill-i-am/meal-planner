import { and, eq, exists, gte, lt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Clock, Effect } from "effect";

import { privateOutputKey } from "../private-output/private-output.contract.js";
import type { AuthOutputFence } from "./auth-output-fence.js";
import {
  account,
  authMutationIntent,
  authMutationReceipt,
  invitation,
  member,
  session,
  verification,
} from "./auth.database-schema.js";

export type AuthAtomicDatabase = Pick<
  DrizzleD1Database,
  "insert" | "update" | "delete" | "select" | "batch"
>;

/** D1's Drizzle batch commits every statement together, including the single-use proof. */
export const makeAuthAtomicStore = (
  getDatabase: () => AuthAtomicDatabase,
  fence: AuthOutputFence
) => {
  const retainIntent = async (id: string, accountId: string) => {
    const database = getDatabase();
    await database
      .insert(authMutationIntent)
      .values({
        accountId,
        createdAt: new Date(await Effect.runPromise(Clock.currentTimeMillis)),
        id,
      })
      .onConflictDoNothing();
  };
  const reconcile = async (id: string, accountId?: string) => {
    const database = getDatabase();
    const [intent] = await database
      .select()
      .from(authMutationIntent)
      .where(eq(authMutationIntent.id, id));
    if (
      !intent ||
      (accountId !== undefined && intent.accountId !== accountId)
    ) {
      return;
    }
    await fence(
      {
        accountId: intent.accountId,
        intentKey: id,
        reconcileOnly: true,
        replayable: true,
      },
      async () => {
        // A terminal no-op receipt also excludes a delayed pre-expiry batch from writing.
        await database
          .insert(authMutationReceipt)
          .values({
            accountId: intent.accountId,
            applied: false,
            attemptId: crypto.randomUUID(),
            createdAt: new Date(
              await Effect.runPromise(Clock.currentTimeMillis)
            ),
            id,
            requestDigest: await privateOutputKey("auth-abandoned", id),
          })
          .onConflictDoNothing();
      }
    );
  };
  return {
    acceptInvitation: async (input: {
      readonly invitationId: string;
      readonly organizationId: string;
      readonly userId: string;
      readonly email: string;
      readonly sessionToken: string;
      readonly memberId: string;
      readonly membershipLimit: number;
    }) => {
      const database = getDatabase();
      const requestDigest = await privateOutputKey(
        "auth-invitation-accept-request",
        JSON.stringify({
          invitationId: input.invitationId,
          organizationId: input.organizationId,
          sessionToken: input.sessionToken,
          userId: input.userId,
        })
      );
      const intentKey = await privateOutputKey(
        "auth-invitation-accept",
        JSON.stringify({
          invitationId: input.invitationId,
          userId: input.userId,
        })
      );
      await retainIntent(intentKey, input.userId);
      return fence(
        { accountId: input.userId, intentKey, replayable: true },
        async () => {
          const now = new Date(
            await Effect.runPromise(Clock.currentTimeMillis)
          );
          const attemptId = crypto.randomUUID();
          const ownsReceipt = exists(
            database
              .select({ id: authMutationReceipt.id })
              .from(authMutationReceipt)
              .where(
                and(
                  eq(authMutationReceipt.id, intentKey),
                  eq(authMutationReceipt.attemptId, attemptId),
                  eq(authMutationReceipt.applied, true)
                )
              )
          );
          const canAccept = and(
            eq(invitation.id, input.invitationId),
            eq(invitation.organizationId, input.organizationId),
            eq(invitation.status, "pending"),
            gte(invitation.expiresAt, now),
            sql`lower(${invitation.email}) = lower(${input.email})`,
            exists(
              database
                .select({ id: session.id })
                .from(session)
                .where(
                  and(
                    eq(session.token, input.sessionToken),
                    eq(session.userId, input.userId),
                    gte(session.expiresAt, now)
                  )
                )
            ),
            exists(
              database
                .select({ id: member.id })
                .from(member)
                .where(
                  and(
                    eq(member.userId, invitation.inviterId),
                    eq(member.organizationId, input.organizationId)
                  )
                )
            ),
            lt(
              database
                .select({ count: sql<number>`count(*)` })
                .from(member)
                .where(eq(member.organizationId, input.organizationId)),
              input.membershipLimit
            )
          );
          await database.batch([
            database
              .insert(authMutationReceipt)
              .values({
                accountId: input.userId,
                applied: exists(
                  database
                    .select({ id: invitation.id })
                    .from(invitation)
                    .where(canAccept)
                ),
                attemptId,
                createdAt: now,
                id: intentKey,
                requestDigest,
              })
              .onConflictDoNothing(),
            database
              .update(invitation)
              .set({ status: "accepted" })
              .where(and(eq(invitation.id, input.invitationId), ownsReceipt)),
            database.insert(member).select(
              database
                .select({
                  createdAt: sql<number>`${now.getTime()}`.as("created_at"),
                  id: sql<string>`${input.memberId}`.as("id"),
                  organizationId: invitation.organizationId,
                  role: invitation.role,
                  userId: sql<string>`${input.userId}`.as("user_id"),
                })
                .from(invitation)
                .where(and(eq(invitation.id, input.invitationId), ownsReceipt))
            ),
            database
              .update(session)
              .set({
                activeOrganizationId: input.organizationId,
                updatedAt: now,
              })
              .where(
                and(
                  eq(session.token, input.sessionToken),
                  eq(session.userId, input.userId),
                  ownsReceipt,
                  exists(
                    database
                      .select({ id: member.id })
                      .from(member)
                      .where(eq(member.id, input.memberId))
                  )
                )
              ),
          ]);
          const [receipt] = await database
            .select()
            .from(authMutationReceipt)
            .where(eq(authMutationReceipt.id, intentKey));
          return (
            receipt?.attemptId === attemptId &&
            receipt.requestDigest === requestDigest &&
            receipt.applied
          );
        }
      );
    },
    reconcileInvitation: async (invitationId: string, userId: string) =>
      reconcile(
        await privateOutputKey(
          "auth-invitation-accept",
          JSON.stringify({ invitationId, userId })
        ),
        userId
      ),
    reconcilePasswordReset: async (identifier: string) =>
      reconcile(await privateOutputKey("auth-password-reset", identifier)),
    resetPassword: async (input: {
      readonly verificationId: string;
      readonly identifier: string;
      readonly userId: string;
      readonly accountId: string;
      readonly issuer: string;
      readonly passwordHash: string;
      readonly requestPassword: string;
    }) => {
      const database = getDatabase();
      const intentKey = await privateOutputKey(
        "auth-password-reset",
        input.identifier
      );
      const requestDigest = await privateOutputKey(
        "auth-password-reset-request",
        JSON.stringify({
          identifier: input.identifier,
          password: input.requestPassword,
        })
      );
      await retainIntent(intentKey, input.userId);
      return fence(
        { accountId: input.userId, intentKey, replayable: true },
        async () => {
          const now = new Date(
            await Effect.runPromise(Clock.currentTimeMillis)
          );
          const attemptId = crypto.randomUUID();
          const proof = and(
            eq(verification.id, input.verificationId),
            eq(verification.identifier, input.identifier),
            eq(verification.value, input.userId),
            gte(verification.expiresAt, now)
          );
          const hasProof = exists(
            database
              .select({ id: verification.id })
              .from(verification)
              .where(proof)
          );
          const ownsReceipt = exists(
            database
              .select({ id: authMutationReceipt.id })
              .from(authMutationReceipt)
              .where(
                and(
                  eq(authMutationReceipt.id, intentKey),
                  eq(authMutationReceipt.attemptId, attemptId),
                  eq(authMutationReceipt.applied, true)
                )
              )
          );
          await database.batch([
            database
              .insert(authMutationReceipt)
              .values({
                accountId: input.userId,
                applied: hasProof,
                attemptId,
                createdAt: now,
                id: intentKey,
                requestDigest,
              })
              .onConflictDoNothing(),
            database
              .insert(account)
              .select(
                database
                  .select({
                    accessToken: sql<null>`NULL`.as("access_token"),
                    accessTokenExpiresAt: sql<null>`NULL`.as(
                      "access_token_expires_at"
                    ),
                    accountId: sql<string>`${input.userId}`.as("account_id"),
                    createdAt: sql<number>`${now.getTime()}`.as("created_at"),
                    id: sql<string>`${input.accountId}`.as("id"),
                    idToken: sql<null>`NULL`.as("id_token"),
                    issuer: sql<string>`${input.issuer}`.as("issuer"),
                    password: sql<string>`${input.passwordHash}`.as("password"),
                    providerId: sql<string>`'credential'`.as("provider_id"),
                    refreshToken: sql<null>`NULL`.as("refresh_token"),
                    refreshTokenExpiresAt: sql<null>`NULL`.as(
                      "refresh_token_expires_at"
                    ),
                    scope: sql<null>`NULL`.as("scope"),
                    updatedAt: sql<number>`${now.getTime()}`.as("updated_at"),
                    userId: sql<string>`${input.userId}`.as("user_id"),
                  })
                  .from(verification)
                  .where(and(proof, ownsReceipt))
              )
              .onConflictDoUpdate({
                set: { password: input.passwordHash, updatedAt: now },
                target: [account.issuer, account.accountId],
              }),
            database
              .delete(session)
              .where(and(eq(session.userId, input.userId), ownsReceipt)),
            database
              .delete(verification)
              .where(
                and(eq(verification.identifier, input.identifier), ownsReceipt)
              )
              .returning({ id: verification.id }),
          ]);
          const [receipt] = await database
            .select()
            .from(authMutationReceipt)
            .where(eq(authMutationReceipt.id, intentKey));
          return (
            receipt?.attemptId === attemptId &&
            receipt.requestDigest === requestDigest &&
            receipt.applied
          );
        }
      );
    },
  };
};

export type AuthAtomicStore = ReturnType<typeof makeAuthAtomicStore>;
