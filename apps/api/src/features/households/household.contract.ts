import { HouseholdOrganizationId as HouseholdOrganizationIdSchema } from "@meal-planner/household-api";
import { Schema } from "effect";

export const HouseholdOrganizationId = HouseholdOrganizationIdSchema;
export type HouseholdOrganizationId = typeof HouseholdOrganizationId.Type;

export const HouseholdEnsureInput = Schema.Struct({
  organizationId: HouseholdOrganizationId,
});
export type HouseholdEnsureInput = typeof HouseholdEnsureInput.Type;

export const HouseholdMetadata = Schema.Struct({
  createdAtEpochMs: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  organizationId: HouseholdOrganizationId,
});
export type HouseholdMetadata = typeof HouseholdMetadata.Type;

export const HouseholdProvenanceMismatch = Schema.TaggedStruct(
  "HouseholdProvenanceMismatch",
  {
    organizationId: HouseholdOrganizationId,
    persistedOrganizationId: HouseholdOrganizationId,
  }
);
export type HouseholdProvenanceMismatch =
  typeof HouseholdProvenanceMismatch.Type;

export const HouseholdPersistenceFailure = Schema.TaggedStruct(
  "HouseholdPersistenceFailure",
  {
    operation: Schema.Literals(["ensure", "read", "save"]),
  }
);
export type HouseholdPersistenceFailure =
  typeof HouseholdPersistenceFailure.Type;

export const HouseholdInvalidInput = Schema.TaggedStruct(
  "HouseholdInvalidInput",
  {}
);
export type HouseholdInvalidInput = typeof HouseholdInvalidInput.Type;

export const HouseholdDomainFailure = Schema.Union([
  HouseholdInvalidInput,
  HouseholdProvenanceMismatch,
  HouseholdPersistenceFailure,
]);
export type HouseholdDomainFailure = typeof HouseholdDomainFailure.Type;

export const householdObjectName = (
  organizationId: HouseholdOrganizationId
): string => `household:v1:${organizationId}`;
