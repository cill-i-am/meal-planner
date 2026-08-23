import { RecipeImportPrincipal } from "@meal-planner/recipe-import-api";
import { Effect, Redacted, Schema } from "effect";

import { AuthPrincipalResolutionError } from "../auth/auth.principal.js";
import type { AuthPrincipalResolver } from "../auth/auth.principal.js";
import type { D1ImportExecutionRepository } from "./import-execution.repository.d1.js";
import { ImportTraceContext } from "./import-observability.js";
import { ImportPrincipal } from "./import-system-principal.js";
import { makeImportSystemAuthorizer } from "./import-system.auth.js";
import { ImportTimestamp } from "./import.contracts.js";
import type { ImportId, SourceCanonicalId } from "./import.contracts.js";

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
  readonly repository: D1ImportExecutionRepository;
  readonly sourceKind: "carousel" | "video";
  readonly trace?: ImportTraceContext;
}) => {
  const trace = input.trace ?? TestImportTrace;
  return input.repository.ensureRun({
    canonicalSourceId: input.canonicalId,
    correlationId: trace.correlationId,
    importId: input.importId,
    sourceType: input.sourceKind,
    startedAt: Schema.decodeUnknownSync(ImportTimestamp)(
      "2026-07-21T09:59:00.000Z"
    ),
  });
};
