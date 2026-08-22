import { Schema } from "effect";

const OpaqueSha256 = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const HouseholdScopeId = OpaqueSha256.pipe(
  Schema.brand("HouseholdScopeId")
);
export type HouseholdScopeId = typeof HouseholdScopeId.Type;

export const ImportActorId = OpaqueSha256.pipe(Schema.brand("ImportActorId"));
export type ImportActorId = typeof ImportActorId.Type;

export const ImportPrincipal = Schema.Struct({
  actorId: ImportActorId,
  householdScopeId: HouseholdScopeId,
});
export type ImportPrincipal = typeof ImportPrincipal.Type;
