import { RecipeImportPrincipal } from "@meal-planner/recipe-import-api";
import { Effect, Redacted, Schema } from "effect";

import { AuthPrincipalResolutionError } from "../auth/auth.principal.js";
import type { AuthPrincipalResolver } from "../auth/auth.principal.js";
import { ImportTraceContext } from "./import-observability.js";
import { ImportPrincipal } from "./import-system-principal.js";
import { makeImportSystemAuthorizer } from "./import-system.auth.js";

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
