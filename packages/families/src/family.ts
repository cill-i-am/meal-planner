import {
  HouseholdOrganizationId,
  HouseholdPersonMutationId,
} from "@meal-planner/household-api";
import { Schema } from "effect";

export const FamilyName = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Enter a family name." }).abort(),
  Schema.isMaxLength(80, { message: "Use 80 characters or fewer." })
);
export const FamilyVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const FamilySetup = Schema.Union([
  Schema.Struct({ status: Schema.Literal("in_progress") }),
  Schema.Struct({
    completedAtEpochMs: Timestamp,
    status: Schema.Literal("complete"),
  }),
]);
export const Family = Schema.Struct({
  canManage: Schema.Boolean,
  createdAtEpochMs: Timestamp,
  id: HouseholdOrganizationId,
  name: FamilyName,
  setup: FamilySetup,
  slug: Schema.NonEmptyString,
  updatedAtEpochMs: Timestamp,
  version: FamilyVersion,
});
export type Family = typeof Family.Type;

export const CreateFamily = Schema.Struct({
  mutationId: HouseholdPersonMutationId,
  name: FamilyName,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type CreateFamily = typeof CreateFamily.Type;
export const UpdateFamily = Schema.Struct({
  expectedVersion: FamilyVersion,
  mutationId: HouseholdPersonMutationId,
  name: FamilyName,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type UpdateFamily = typeof UpdateFamily.Type;
