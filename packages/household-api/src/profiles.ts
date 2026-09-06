import { Data, Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

import { HouseholdPeopleAuditActorId } from "./people-http.js";
import { HouseholdPersonId, HouseholdPersonMutationId } from "./people.js";

/** Stable identity of one household-local profile fact, including its history. */
export const ProfileFactId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^fact_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
  ),
  Schema.brand("ProfileFactId")
);
export type ProfileFactId = typeof ProfileFactId.Type;

/** Zero is the empty profile; every committed change increments this version. */
export const ProfileVersion = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("ProfileVersion")
);
export type ProfileVersion = typeof ProfileVersion.Type;

export const ProfileLabel = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(120))
);

export const FoodPreference = Schema.Struct({
  _tag: Schema.Literal("FoodPreference"),
  label: ProfileLabel,
  sentiment: Schema.Literals(["like", "dislike", "strong_dislike"]),
  targetKind: Schema.Literals(["ingredient", "dish", "cuisine"]),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

export const HardConstraint = Schema.Struct({
  _tag: Schema.Literal("HardConstraint"),
  category: Schema.Literals([
    "allergen",
    "dietary_rule",
    "ingredient_avoidance",
    "other_safety",
  ]),
  handling: Schema.Literals(["exclude", "requires_adaptation"]),
  label: ProfileLabel,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

export const ProfileFactValue = Schema.Union([
  FoodPreference,
  HardConstraint,
  Schema.Struct({ _tag: Schema.Literal("NoKnownHardConstraints") }).pipe(
    Schema.annotate({ parseOptions: { onExcessProperty: "error" } })
  ),
]);
export type ProfileFactValue = typeof ProfileFactValue.Type;

export const ProfileFactStanding = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("provisional") }),
  Schema.Struct({
    _tag: Schema.Literal("confirmed"),
    basis: Schema.Literals(["self", "household_adult"]),
  }),
]);
export type ProfileFactStanding = typeof ProfileFactStanding.Type;

export const ProfileFact = Schema.Struct({
  createdAtEpochMs: Schema.Int,
  createdBy: HouseholdPeopleAuditActorId,
  createdInVersion: ProfileVersion,
  id: ProfileFactId,
  source: Schema.Literals(["manual_ui", "interview"]),
  standing: ProfileFactStanding,
  updatedAtEpochMs: Schema.Int,
  updatedBy: HouseholdPeopleAuditActorId,
  updatedInVersion: ProfileVersion,
  value: ProfileFactValue,
});
export type ProfileFact = typeof ProfileFact.Type;

export const ProfileCommand = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("AddProvisionalProfileFact"),
    fact: ProfileFactValue,
  }),
  Schema.Struct({
    _tag: Schema.Literal("AddConfirmedProfileFact"),
    basis: Schema.Literals(["self", "household_adult"]),
    fact: ProfileFactValue,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ConfirmProfileFact"),
    basis: Schema.Literals(["self", "household_adult"]),
    factId: ProfileFactId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ReplaceOrdinaryProfileFact"),
    fact: FoodPreference,
    factId: ProfileFactId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RemoveOrdinaryProfileFact"),
    factId: ProfileFactId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ConfirmHardConstraintReduction"),
    confirmation: Schema.Literal("I confirm this safety constraint change"),
    factId: ProfileFactId,
    replacement: Schema.NullOr(ProfileFactValue),
  }),
]).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ProfileCommand = typeof ProfileCommand.Type;

export const MutatePersonProfilePayload = Schema.Struct({
  command: ProfileCommand,
  expectedProfileVersion: ProfileVersion,
  mutationId: HouseholdPersonMutationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type MutatePersonProfilePayload = typeof MutatePersonProfilePayload.Type;

/** Each version is also its immutable audit record; there is no second writer. */
export const ProfileAudit = Schema.Struct({
  actorId: HouseholdPeopleAuditActorId,
  actorPersonId: HouseholdPersonId,
  after: Schema.NullOr(ProfileFact),
  atEpochMs: Schema.Int,
  before: Schema.NullOr(ProfileFact),
  command: ProfileCommand,
  nextVersion: ProfileVersion,
  previousVersion: ProfileVersion,
  source: Schema.Literals(["manual_ui", "interview"]),
});
export const ProfileAuditPage = Schema.Struct({
  events: Schema.Array(ProfileAudit),
  nextBeforeVersion: Schema.NullOr(ProfileVersion),
});
export const PersonProfile = Schema.Struct({
  audit: Schema.NullOr(ProfileAudit),
  facts: Schema.Array(ProfileFact),
  personId: HouseholdPersonId,
  version: ProfileVersion,
});
export type PersonProfile = typeof PersonProfile.Type;

export const ProfileVersionPage = Schema.Struct({
  nextBeforeVersion: Schema.NullOr(ProfileVersion),
  versions: Schema.Array(PersonProfile),
});
export type ProfileVersionPage = typeof ProfileVersionPage.Type;

export class HouseholdProfileRejected extends Data.TaggedError(
  "HouseholdProfileRejected"
)<{
  readonly reason:
    | "person_not_found"
    | "adult_required"
    | "person_archived"
    | "stale_version"
    | "mutation_collision"
    | "fact_not_found"
    | "self_required"
    | "safety_confirmation_required"
    | "fact_conflict"
    | "profile_unavailable";
}> {}

const ProfileConflict = Schema.Struct({
  code: Schema.Literals([
    "person_not_found",
    "adult_required",
    "person_archived",
    "stale_version",
    "mutation_collision",
    "fact_not_found",
    "self_required",
    "safety_confirmation_required",
    "fact_conflict",
  ]),
  message: Schema.String,
}).pipe(HttpApiSchema.status(409));
const ProfileUnavailable = Schema.Struct({
  code: Schema.Literal("profile_unavailable"),
  message: Schema.String,
}).pipe(HttpApiSchema.status(503));
export const HouseholdProfileProblem = Schema.Union([
  ProfileConflict,
  ProfileUnavailable,
]);
export const HouseholdProfileErrors = [ProfileConflict, ProfileUnavailable];

export const ListProfileVersionsQuery = Schema.Struct({
  beforeVersion: Schema.optional(
    Schema.NumberFromString.pipe(
      Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
    )
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

export const InterviewProfileOutcome = Schema.Union([
  Schema.Struct({
    profileVersion: ProfileVersion,
    type: Schema.Literal("committed"),
  }),
  Schema.Struct({
    reason: Schema.Literals([
      "person_not_found",
      "adult_required",
      "person_archived",
      "stale_version",
      "mutation_collision",
      "fact_not_found",
      "self_required",
      "safety_confirmation_required",
      "fact_conflict",
    ]),
    type: Schema.Literal("rejected"),
  }),
]);
export type InterviewProfileOutcome = typeof InterviewProfileOutcome.Type;
