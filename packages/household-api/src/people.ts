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

/** Privacy-safe account-association state for one household person. */
export const HouseholdPersonAssociationState = Schema.Literals([
  "unlinked",
  "invitation_pending",
  "linked",
  "departure_pending",
  "detached",
]);
/** Privacy-safe account-association state for one household person. */
export type HouseholdPersonAssociationState =
  typeof HouseholdPersonAssociationState.Type;

/** Purpose-bound digest of one Better Auth invitation identity. */
export const HouseholdInvitationDigest = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u)),
  Schema.brand("HouseholdInvitationDigest")
);
/** Purpose-bound digest of one Better Auth invitation identity. */
export type HouseholdInvitationDigest = typeof HouseholdInvitationDigest.Type;

/** Stable household-local identity for one account-to-person link history. */
export const HouseholdPersonLinkId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^link_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
  ),
  Schema.brand("HouseholdPersonLinkId")
);
/** Stable household-local identity for one account-to-person link history. */
export type HouseholdPersonLinkId = typeof HouseholdPersonLinkId.Type;

/** Stable household-local identity for one coordinated member departure. */
export const HouseholdMemberDepartureOperationId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^departure_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
  ),
  Schema.brand("HouseholdMemberDepartureOperationId")
);
/** Stable household-local identity for one coordinated member departure. */
export type HouseholdMemberDepartureOperationId =
  typeof HouseholdMemberDepartureOperationId.Type;

/** Monotonic optimistic-concurrency version for a link or departure. */
export const HouseholdAssociationVersion = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("HouseholdAssociationVersion")
);
/** Monotonic optimistic-concurrency version for a link or departure. */
export type HouseholdAssociationVersion =
  typeof HouseholdAssociationVersion.Type;

/** Closed durable state of one membership-departure operation. */
export const HouseholdMemberDepartureState = Schema.Literals([
  "prepared",
  "revoking_access",
  "revocation_repair_required",
  "access_revoked",
  "finalization_repair_required",
  "completed",
  "cancelled",
]);
/** Closed durable state of one membership-departure operation. */
export type HouseholdMemberDepartureState =
  typeof HouseholdMemberDepartureState.Type;

/** Privacy-safe reason for an explicit repair or coordinated departure. */
export const HouseholdPeopleOperationReason = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(200)
  ),
  Schema.brand("HouseholdPeopleOperationReason")
);
/** Privacy-safe reason for an explicit repair or coordinated departure. */
export type HouseholdPeopleOperationReason =
  typeof HouseholdPeopleOperationReason.Type;

/** Monotonic optimistic-concurrency version for one person. */
export const HouseholdPersonVersion = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("HouseholdPersonVersion")
);
/** Monotonic optimistic-concurrency version for one person. */
export type HouseholdPersonVersion = typeof HouseholdPersonVersion.Type;

/** Privacy-safe household roster projection. */
export const HouseholdPerson = Schema.Struct({
  associationState: HouseholdPersonAssociationState,
  associationVersion: Schema.NullOr(HouseholdAssociationVersion),
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

/** Opaque Better Auth resource identity accepted only at the public API edge. */
export const HouseholdAuthResourceId = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(255)
  ),
  Schema.brand("HouseholdAuthResourceId")
);
/** Opaque Better Auth resource identity accepted only at the public API edge. */
export type HouseholdAuthResourceId = typeof HouseholdAuthResourceId.Type;

/** Invitation email accepted only by the Better Auth control-plane adapter. */
export const HouseholdInvitationEmail = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(320)
  ),
  Schema.brand("HouseholdInvitationEmail")
);
/** Invitation email accepted only by the Better Auth control-plane adapter. */
export type HouseholdInvitationEmail = typeof HouseholdInvitationEmail.Type;

/** Organizer request to create and associate one Better Auth invitation. */
export const InviteHouseholdAdultPayload = Schema.Struct({
  email: HouseholdInvitationEmail,
  mutationId: HouseholdPersonMutationId,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type InviteHouseholdAdultPayload =
  typeof InviteHouseholdAdultPayload.Type;

/** Explicit retry after invitation creation committed but association did not. */
export const AssociateHouseholdAdultInvitationPayload = Schema.Struct({
  invitationId: HouseholdAuthResourceId,
  mutationId: HouseholdPersonMutationId,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type AssociateHouseholdAdultInvitationPayload =
  typeof AssociateHouseholdAdultInvitationPayload.Type;

/** Accepted member request to link the explicitly associated adult. */
export const CompleteHouseholdAdultLinkPayload = Schema.Struct({
  invitationId: HouseholdAuthResourceId,
  mutationId: HouseholdPersonMutationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type CompleteHouseholdAdultLinkPayload =
  typeof CompleteHouseholdAdultLinkPayload.Type;

/** Organizer request to explicitly repair one member-to-person link. */
export const RepairHouseholdAdultLinkPayload = Schema.Struct({
  expectedPersonVersion: HouseholdPersonVersion,
  memberId: HouseholdAuthResourceId,
  mutationId: HouseholdPersonMutationId,
  personId: HouseholdPersonId,
  reason: HouseholdPeopleOperationReason,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type RepairHouseholdAdultLinkPayload =
  typeof RepairHouseholdAdultLinkPayload.Type;

/** Owner-or-self request to begin one coordinated membership departure. */
export const DepartHouseholdAdultPayload = Schema.Struct({
  expectedLinkVersion: HouseholdAssociationVersion,
  expectedPersonVersion: HouseholdPersonVersion,
  memberId: HouseholdAuthResourceId,
  mutationId: HouseholdPersonMutationId,
  personId: HouseholdPersonId,
  reason: HouseholdPeopleOperationReason,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type DepartHouseholdAdultPayload =
  typeof DepartHouseholdAdultPayload.Type;

/** Member-or-owner cancellation while a departure is still prepared. */
export const CancelHouseholdAdultDeparturePayload = Schema.Struct({
  expectedOperationVersion: HouseholdAssociationVersion,
  mutationId: HouseholdPersonMutationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type CancelHouseholdAdultDeparturePayload =
  typeof CancelHouseholdAdultDeparturePayload.Type;

/** Explicit member-or-owner repair of one visible departure operation. */
export const RetryHouseholdAdultDeparturePayload = Schema.Struct({
  expectedOperationVersion: HouseholdAssociationVersion,
  memberId: HouseholdAuthResourceId,
  mutationId: HouseholdPersonMutationId,
  reason: HouseholdPeopleOperationReason,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type RetryHouseholdAdultDeparturePayload =
  typeof RetryHouseholdAdultDeparturePayload.Type;

/** Returning member request to restore and relink one archived adult. */
export const ReturnHouseholdAdultPayload = Schema.Struct({
  expectedPersonVersion: HouseholdPersonVersion,
  invitationId: HouseholdAuthResourceId,
  mutationId: HouseholdPersonMutationId,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type ReturnHouseholdAdultPayload =
  typeof ReturnHouseholdAdultPayload.Type;

/** Explicit control-plane/household split outcome for invitation creation. */
export const HouseholdAdultInvitationResult = Schema.Struct({
  association: Schema.Literals(["associated", "association_required"]),
  invitationId: HouseholdAuthResourceId,
  person: Schema.NullOr(HouseholdPerson),
});
export type HouseholdAdultInvitationResult =
  typeof HouseholdAdultInvitationResult.Type;

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

/** Owner command associating one unlinked adult with an invitation. */
export const AssociateAdultInvitationPayload = Schema.Struct({
  invitationDigest: HouseholdInvitationDigest,
  mutationId: HouseholdPersonMutationId,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Owner command associating one unlinked adult with an invitation. */
export type AssociateAdultInvitationPayload =
  typeof AssociateAdultInvitationPayload.Type;

/** Accepted member command linking to the explicitly associated adult. */
export const CompleteAcceptedAdultLinkPayload = Schema.Struct({
  invitationDigest: HouseholdInvitationDigest,
  mutationId: HouseholdPersonMutationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Accepted member command linking to the explicitly associated adult. */
export type CompleteAcceptedAdultLinkPayload =
  typeof CompleteAcceptedAdultLinkPayload.Type;

/** Explicit organizer-authorized repair of an account-to-person link. */
export const RepairAdultAccountLinkPayload = Schema.Struct({
  expectedPersonVersion: HouseholdPersonVersion,
  mutationId: HouseholdPersonMutationId,
  personId: HouseholdPersonId,
  reason: HouseholdPeopleOperationReason,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Explicit organizer-authorized repair of an account-to-person link. */
export type RepairAdultAccountLinkPayload =
  typeof RepairAdultAccountLinkPayload.Type;

/** Prepare one durable member-departure operation before access mutation. */
export const PrepareMemberDeparturePayload = Schema.Struct({
  expectedLinkVersion: HouseholdAssociationVersion,
  expectedPersonVersion: HouseholdPersonVersion,
  mutationId: HouseholdPersonMutationId,
  personId: HouseholdPersonId,
  reason: HouseholdPeopleOperationReason,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Prepare one durable member-departure operation before access mutation. */
export type PrepareMemberDeparturePayload =
  typeof PrepareMemberDeparturePayload.Type;

/** Cancel one departure while it is still prepared. */
export const CancelMemberDeparturePayload = Schema.Struct({
  expectedOperationVersion: HouseholdAssociationVersion,
  mutationId: HouseholdPersonMutationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Cancel one departure while it is still prepared. */
export type CancelMemberDeparturePayload =
  typeof CancelMemberDeparturePayload.Type;

/** Resume a visible repair-required departure phase. */
export const RetryMemberDeparturePayload = Schema.Struct({
  expectedOperationVersion: HouseholdAssociationVersion,
  mutationId: HouseholdPersonMutationId,
  reason: HouseholdPeopleOperationReason,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Resume a visible repair-required departure phase. */
export type RetryMemberDeparturePayload =
  typeof RetryMemberDeparturePayload.Type;

/** Restore and link the same historical adult after a later invitation. */
export const RestoreReturningAdultLinkPayload = Schema.Struct({
  expectedPersonVersion: HouseholdPersonVersion,
  invitationDigest: HouseholdInvitationDigest,
  mutationId: HouseholdPersonMutationId,
  personId: HouseholdPersonId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
/** Restore and link the same historical adult after a later invitation. */
export type RestoreReturningAdultLinkPayload =
  typeof RestoreReturningAdultLinkPayload.Type;

/** Privacy-safe projection of one durable membership-departure operation. */
export const HouseholdMemberDepartureOperation = Schema.Struct({
  canRetry: Schema.Boolean,
  executionGeneration: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1))
  ),
  lastAttemptAtEpochMs: Schema.NullOr(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
  ),
  operationId: HouseholdMemberDepartureOperationId,
  personId: HouseholdPersonId,
  state: HouseholdMemberDepartureState,
  version: HouseholdAssociationVersion,
});
/** Privacy-safe projection of one durable membership-departure operation. */
export type HouseholdMemberDepartureOperation =
  typeof HouseholdMemberDepartureOperation.Type;

/** Result of a fresh start or replay of one departure coordinator claim. */
export const HouseholdMemberDepartureStart = Schema.Struct({
  attemptClaimed: Schema.Boolean,
  operation: HouseholdMemberDepartureOperation,
});
/** Result of a fresh start or replay of one departure coordinator claim. */
export type HouseholdMemberDepartureStart =
  typeof HouseholdMemberDepartureStart.Type;

/** Query option controlling whether archived people are returned. */
export const ListHouseholdPeopleUrlParams = Schema.Struct({
  includeArchived: Schema.optionalKey(Schema.Literals(["true", "false"])),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
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

/** The requested invitation or account association conflicts with household authority. */
export const HouseholdPersonAssociationConflict = Schema.TaggedStruct(
  "HouseholdPersonAssociationConflict",
  {}
);
/** The requested invitation or account association conflicts with household authority. */
export type HouseholdPersonAssociationConflict =
  typeof HouseholdPersonAssociationConflict.Type;

/** Another nonterminal departure already owns this person or link. */
export const HouseholdMemberDepartureInProgress = Schema.TaggedStruct(
  "HouseholdMemberDepartureInProgress",
  {}
);
/** Another nonterminal departure already owns this person or link. */
export type HouseholdMemberDepartureInProgress =
  typeof HouseholdMemberDepartureInProgress.Type;

/** The requested departure transition is not legal from current authority. */
export const HouseholdMemberDepartureConflict = Schema.TaggedStruct(
  "HouseholdMemberDepartureConflict",
  {}
);
/** The requested departure transition is not legal from current authority. */
export type HouseholdMemberDepartureConflict =
  typeof HouseholdMemberDepartureConflict.Type;

/** The expected departure or account-link version is stale. */
export const HouseholdAssociationStaleVersion = Schema.TaggedStruct(
  "HouseholdAssociationStaleVersion",
  {}
);
/** The expected departure or account-link version is stale. */
export type HouseholdAssociationStaleVersion =
  typeof HouseholdAssociationStaleVersion.Type;

/** Household-local persistence or encoding was unavailable. */
export const HouseholdPeopleUnavailable = Schema.TaggedStruct(
  "HouseholdPeopleUnavailable",
  {}
);
/** Household-local persistence or encoding was unavailable. */
export type HouseholdPeopleUnavailable = typeof HouseholdPeopleUnavailable.Type;

/** Closed failure family for person commands and queries. */
export type HouseholdPeopleFailure =
  | HouseholdAssociationStaleVersion
  | HouseholdCreatorBootstrapConflict
  | HouseholdMemberDepartureConflict
  | HouseholdMemberDepartureInProgress
  | HouseholdPeopleUnavailable
  | HouseholdPersonAssociationConflict
  | HouseholdPersonLifecycleConflict
  | HouseholdPersonMutationCollision
  | HouseholdPersonNotFound
  | HouseholdPersonStaleVersion;
