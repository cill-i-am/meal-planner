import { Schema } from "effect";

/** Stable opaque identity generated inside one household authority. */
export const HouseholdPersonId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^person_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
  ),
  Schema.brand("HouseholdPersonId")
);
/** Stable opaque identity generated inside one household authority. */
export type HouseholdPersonId = typeof HouseholdPersonId.Type;

/** Client-stable identifier used to make one mutation safely replayable. */
export const HouseholdPersonMutationId = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isPattern(/^[A-Za-z\d][A-Za-z\d_-]{7,127}$/u)
  ),
  Schema.brand("HouseholdPersonMutationId")
);
/** Client-stable identifier used to make one mutation safely replayable. */
export type HouseholdPersonMutationId = typeof HouseholdPersonMutationId.Type;

/** Household-visible label chosen explicitly by an adult. */
export const HouseholdPersonDisplayName = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(80)),
  Schema.brand("HouseholdPersonDisplayName")
);
/** Household-visible label chosen explicitly by an adult. */
export type HouseholdPersonDisplayName = typeof HouseholdPersonDisplayName.Type;

/** Durable person kind. Account-link state is deliberately separate. */
export const HouseholdPersonKind = Schema.Literals(["adult", "dependant"]);
/** Durable person kind. Account-link state is deliberately separate. */
export type HouseholdPersonKind = typeof HouseholdPersonKind.Type;

/** Reversible lifecycle state; hard deletion does not exist. */
export const HouseholdPersonLifecycle = Schema.Literals(["active", "archived"]);
/** Reversible lifecycle state; hard deletion does not exist. */
export type HouseholdPersonLifecycle = typeof HouseholdPersonLifecycle.Type;

/** Monotonic optimistic-concurrency version for one person. */
export const HouseholdPersonVersion = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("HouseholdPersonVersion")
);
/** Monotonic optimistic-concurrency version for one person. */
export type HouseholdPersonVersion = typeof HouseholdPersonVersion.Type;

/** Privacy-safe household roster projection. */
export const HouseholdPerson = Schema.Struct({
  createdAtEpochMs: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  displayName: HouseholdPersonDisplayName,
  id: HouseholdPersonId,
  isCurrentAdult: Schema.Boolean,
  kind: HouseholdPersonKind,
  lifecycle: HouseholdPersonLifecycle,
  updatedAtEpochMs: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  version: HouseholdPersonVersion,
});
/** Privacy-safe household roster projection. */
export type HouseholdPerson = typeof HouseholdPerson.Type;

/** Privacy-safe occupancy state of the household-singleton creator slot. */
export const HouseholdCreatorSlot = Schema.Literals(["available", "occupied"]);
/** Privacy-safe occupancy state of the household-singleton creator slot. */
export type HouseholdCreatorSlot = typeof HouseholdCreatorSlot.Type;

/** Household roster, creator-slot state, and admitted member's linked person. */
export const HouseholdPeopleRoster = Schema.Struct({
  creatorSlot: HouseholdCreatorSlot,
  currentPersonId: Schema.NullOr(HouseholdPersonId),
  people: Schema.Array(HouseholdPerson),
});
/** Household roster, creator-slot state, and admitted member's linked person. */
export type HouseholdPeopleRoster = typeof HouseholdPeopleRoster.Type;

/** Explicit creator-person bootstrap command. */
export const BootstrapHouseholdCreatorPayload = Schema.Struct({
  displayName: HouseholdPersonDisplayName,
  mutationId: HouseholdPersonMutationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Explicit creator-person bootstrap command. */
export type BootstrapHouseholdCreatorPayload =
  typeof BootstrapHouseholdCreatorPayload.Type;

/** Command to create an unlinked adult or dependant. */
export const CreateHouseholdPersonPayload = Schema.Struct({
  displayName: HouseholdPersonDisplayName,
  kind: HouseholdPersonKind,
  mutationId: HouseholdPersonMutationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Command to create an unlinked adult or dependant. */
export type CreateHouseholdPersonPayload =
  typeof CreateHouseholdPersonPayload.Type;

/** Optimistic archive or restore command. */
export const TransitionHouseholdPersonPayload = Schema.Struct({
  expectedVersion: HouseholdPersonVersion,
  mutationId: HouseholdPersonMutationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Optimistic archive or restore command. */
export type TransitionHouseholdPersonPayload =
  typeof TransitionHouseholdPersonPayload.Type;

/** Query option controlling whether archived people are returned. */
export const ListHouseholdPeopleUrlParams = Schema.Struct({
  includeArchived: Schema.optionalKey(Schema.Literals(["true", "false"])),
});
/** Query option controlling whether archived people are returned. */
export type ListHouseholdPeopleUrlParams =
  typeof ListHouseholdPeopleUrlParams.Type;

/** A mutation ID was reused for a different admitted intent. */
export const HouseholdPersonMutationCollision = Schema.TaggedStruct(
  "HouseholdPersonMutationCollision",
  {}
);
/** A mutation ID was reused for a different admitted intent. */
export type HouseholdPersonMutationCollision =
  typeof HouseholdPersonMutationCollision.Type;

/** The household creator slot is occupied and this admitted account remains unlinked. */
export const HouseholdCreatorBootstrapConflict = Schema.TaggedStruct(
  "HouseholdCreatorBootstrapConflict",
  {}
);
/** The household creator slot is occupied and this admitted account remains unlinked. */
export type HouseholdCreatorBootstrapConflict =
  typeof HouseholdCreatorBootstrapConflict.Type;

/** The person does not exist in this admitted household. */
export const HouseholdPersonNotFound = Schema.TaggedStruct(
  "HouseholdPersonNotFound",
  {}
);
/** The person does not exist in this admitted household. */
export type HouseholdPersonNotFound = typeof HouseholdPersonNotFound.Type;

/** The expected person version is no longer current. */
export const HouseholdPersonStaleVersion = Schema.TaggedStruct(
  "HouseholdPersonStaleVersion",
  {}
);
/** The expected person version is no longer current. */
export type HouseholdPersonStaleVersion =
  typeof HouseholdPersonStaleVersion.Type;

/** The requested lifecycle transition is not legal from the current state. */
export const HouseholdPersonLifecycleConflict = Schema.TaggedStruct(
  "HouseholdPersonLifecycleConflict",
  {}
);
/** The requested lifecycle transition is not legal from the current state. */
export type HouseholdPersonLifecycleConflict =
  typeof HouseholdPersonLifecycleConflict.Type;

/** Household-local persistence or encoding was unavailable. */
export const HouseholdPeopleUnavailable = Schema.TaggedStruct(
  "HouseholdPeopleUnavailable",
  {}
);
/** Household-local persistence or encoding was unavailable. */
export type HouseholdPeopleUnavailable = typeof HouseholdPeopleUnavailable.Type;

/** Closed failure family for person commands and queries. */
export type HouseholdPeopleFailure =
  | HouseholdCreatorBootstrapConflict
  | HouseholdPeopleUnavailable
  | HouseholdPersonLifecycleConflict
  | HouseholdPersonMutationCollision
  | HouseholdPersonNotFound
  | HouseholdPersonStaleVersion;
