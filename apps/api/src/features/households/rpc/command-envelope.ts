import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

export const HouseholdActorId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u)),
  Schema.brand("HouseholdActorId")
);
export type HouseholdActorId = typeof HouseholdActorId.Type;

export const HouseholdSystemPurpose = Schema.Literals([
  "import_workflow_dispatch",
]);
export type HouseholdSystemPurpose = typeof HouseholdSystemPurpose.Type;

export const HouseholdMemberActor = Schema.Struct({
  _tag: Schema.Literal("Member"),
  actorId: HouseholdActorId,
});
export type HouseholdMemberActor = typeof HouseholdMemberActor.Type;

export const HouseholdSystemActor = Schema.Struct({
  _tag: Schema.Literal("System"),
  purpose: HouseholdSystemPurpose,
});
export type HouseholdSystemActor = typeof HouseholdSystemActor.Type;

export const HouseholdMemberAdmission = Schema.Struct({
  actor: HouseholdMemberActor,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdMemberAdmission = typeof HouseholdMemberAdmission.Type;

export const HouseholdSystemAdmission = Schema.Struct({
  actor: HouseholdSystemActor,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdSystemAdmission = typeof HouseholdSystemAdmission.Type;

export const HouseholdCommandAdmission = Schema.Union([
  HouseholdMemberAdmission,
  HouseholdSystemAdmission,
]);
export type HouseholdCommandAdmission = typeof HouseholdCommandAdmission.Type;

export const makeHouseholdMemberAdmission = (input: {
  readonly actorId: string;
  readonly organizationId: HouseholdOrganizationId;
}) =>
  Schema.decodeUnknownEffect(HouseholdMemberAdmission)({
    actor: { _tag: "Member", actorId: input.actorId },
    organizationId: input.organizationId,
  });

export const HouseholdCommandPurpose = Schema.Literals([
  "admit_import_workflow",
  "approve_meal_plan",
  "create_meal_plan",
  "ensure_household",
  "read_meal_plan",
  "reject_meal_plan",
  "swap_meal_plan",
]);
export type HouseholdCommandPurpose = typeof HouseholdCommandPurpose.Type;

export const HouseholdAuthorizationFailure = Schema.TaggedStruct(
  "HouseholdAuthorizationFailure",
  {}
);
export type HouseholdAuthorizationFailure =
  typeof HouseholdAuthorizationFailure.Type;

const memberPurposes: ReadonlySet<HouseholdCommandPurpose> = new Set([
  "approve_meal_plan",
  "create_meal_plan",
  "ensure_household",
  "read_meal_plan",
  "reject_meal_plan",
  "swap_meal_plan",
]);

export const requireHouseholdCommandAdmission = (
  admission: HouseholdCommandAdmission,
  purpose: HouseholdCommandPurpose
) => {
  const permitted =
    admission.actor._tag === "Member"
      ? memberPurposes.has(purpose)
      : admission.actor.purpose === "import_workflow_dispatch" &&
        purpose === "admit_import_workflow";
  return permitted
    ? Effect.succeed(admission)
    : Effect.fail(HouseholdAuthorizationFailure.make({}));
};
