import {
  CanonicalTikTokUrl,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportIntentId,
  RecipeImportPrincipal,
} from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Redacted, Schema } from "effect";

import { AuthPrincipalResolutionError } from "../auth/auth.principal.js";
import type { AuthPrincipalResolver } from "../auth/auth.principal.js";
import {
  ImportIntentIdGenerator,
  ImportPrincipal,
  makeImportIntentApplication,
} from "./import-intent.js";
import type { AcquisitionGeneration } from "./import-media.model.js";
import { ImportTraceContext } from "./import-observability.js";
import { makeImportSystemAuthorizer } from "./import-system.auth.js";
import { ImportTimestamp } from "./import.contracts.js";
import type {
  ImportId,
  ImportView,
  SourceCanonicalId,
} from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import type { ImportIntentRepository } from "./import.repository.js";

export const TestImportPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
  actorId: "a".repeat(64),
  householdScopeId: "b".repeat(64),
});

export const TestImportTrace = Schema.decodeUnknownSync(ImportTraceContext)({
  correlationId: "11111111-1111-4111-8111-111111111111",
});

export const makeTestSystemAuthorizer = (token: string) =>
  makeImportSystemAuthorizer({
    principal: TestImportPrincipal,
    token: Redacted.make(token),
  });

export const makeTestAuthPrincipalResolver = (
  sessionToken: string,
  principal = TestImportPrincipal
): AuthPrincipalResolver => ({
  resolve: (headers) =>
    headers.get("cookie") === `better-auth.session_token=${sessionToken}`
      ? Effect.succeed(
          Schema.decodeUnknownSync(RecipeImportPrincipal)(principal)
        )
      : Effect.fail(
          new AuthPrincipalResolutionError({ reason: "invalid_session" })
        ),
});

export const admitResolvedTestImport = (input: {
  readonly canonicalId: SourceCanonicalId;
  readonly importId: ImportId;
  readonly repository: ImportIntentRepository;
  readonly sourceKind: "carousel" | "video";
  readonly trace?: ImportTraceContext;
}) => {
  const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
    input.importId
  );
  const canonicalUrl = Schema.decodeUnknownSync(CanonicalTikTokUrl)(
    `https://www.tiktok.com/@cook/${input.sourceKind === "carousel" ? "photo" : "video"}/${input.canonicalId}`
  );
  const application = makeImportIntentApplication(
    input.repository,
    { ensureStarted: () => Effect.succeed("created" as const) },
    input.trace ?? TestImportTrace
  );
  const request = Schema.decodeUnknownSync(CreateRecipeImportIntentRequest)({
    source: { kind: "tiktok", url: canonicalUrl },
  });
  const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey)(
    `test-import-${intentId}`
  );

  return Effect.gen(function* admitResolvedFixture() {
    yield* application
      .admit(TestImportPrincipal, request, idempotencyKey)
      .pipe(
        Effect.provideService(
          ImportIntentIdGenerator,
          ImportIntentIdGenerator.of({ next: Effect.succeed(intentId) })
        )
      );
    return yield* application.resolveSource(TestImportPrincipal, {
      canonicalSourceId: input.canonicalId,
      canonicalUrl,
      intentId,
      sourceKind: input.sourceKind,
    });
  });
};

export const seedResolvedTestImportExecution = async (input: {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly canonicalId: SourceCanonicalId;
  readonly database: AnyD1Database;
  readonly evidence: ImportView["evidence"];
  readonly importId: ImportId;
  readonly sourceKind?: "carousel" | "video";
  readonly status: ImportView["status"];
  readonly trace?: ImportTraceContext;
  readonly updatedAt: ImportTimestamp;
}): Promise<void> => {
  const updatedAt = Schema.encodeSync(ImportTimestamp)(input.updatedAt);
  const repository = makeD1ImportRepository(input.database, () =>
    Date.parse(updatedAt)
  );
  const admission = {
    canonicalId: input.canonicalId,
    importId: input.importId,
    repository,
    sourceKind: input.sourceKind ?? "video",
  };
  await Effect.runPromise(
    admitResolvedTestImport(
      input.trace === undefined
        ? admission
        : { ...admission, trace: input.trace }
    )
  );
  const statusCode = "code" in input.status ? input.status.code : null;
  const recoveryAction =
    "recovery" in input.status ? input.status.recovery : null;
  await input.database
    .prepare(
      `UPDATE recipe_imports
          SET acquisition_generation = ?, evidence_references_json = ?,
              recovery_action = ?, status = ?, status_code = ?, updated_at = ?
        WHERE id = ?`
    )
    .bind(
      input.acquisitionGeneration,
      JSON.stringify(input.evidence),
      recoveryAction,
      input.status.kind,
      statusCode,
      updatedAt,
      input.importId
    )
    .run();
};
