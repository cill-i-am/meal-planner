import { HouseholdOrganizationId as HouseholdOrganizationIdSchema } from "@meal-planner/household-api";
import { Schema } from "effect";

import {
  HouseholdAuthorizationFailure,
  HouseholdMemberAdmission,
} from "./rpc/command-envelope.js";

export const HouseholdOrganizationId = HouseholdOrganizationIdSchema;
export type HouseholdOrganizationId = typeof HouseholdOrganizationId.Type;

export const HouseholdEnsureInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
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
  {}
);
export type HouseholdProvenanceMismatch =
  typeof HouseholdProvenanceMismatch.Type;

export const HouseholdPersistenceFailure = Schema.TaggedStruct(
  "HouseholdPersistenceFailure",
  {
    operation: Schema.Literals(["ensure", "read"]),
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
  HouseholdAuthorizationFailure,
  HouseholdProvenanceMismatch,
  HouseholdPersistenceFailure,
]);
export type HouseholdDomainFailure = typeof HouseholdDomainFailure.Type;
