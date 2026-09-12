import { Data, Schema } from "effect";

export const PRIVATE_DISCOVERY_FALLBACK_NEED_LIMIT = 3;
export const PRIVATE_DISCOVERY_FALLBACK_UPDATE_LIMIT = 6;

const text = (maximum: number) =>
  Schema.String.pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))
  );
const MessageId = Schema.String.pipe(Schema.check(Schema.isUUID()));
const NeedId = text(64);
const Subject = text(120);

export const PrivateDiscoveryEvidenceMessage = Schema.Struct({
  id: MessageId,
  role: Schema.Literals(["participant", "assistant"]),
  text: text(4000),
});
export type PrivateDiscoveryEvidenceMessage =
  typeof PrivateDiscoveryEvidenceMessage.Type;
export const PrivateDiscoveryEvidence = Schema.Struct({
  messageId: MessageId,
  quote: text(400).pipe(Schema.check(Schema.isTrimmed())),
}).pipe(Schema.annotate({ identifier: "PrivateDiscoveryEvidence" }));
type Evidence = typeof PrivateDiscoveryEvidence.Type;
const OptionalEvidence = Schema.NullOr(PrivateDiscoveryEvidence);

export const MealFallbackOption = Schema.Struct({
  description: text(200),
  kind: Schema.Literals(["generic", "exact"]),
  quantity: Schema.NullOr(text(120)),
  substitutions: Schema.NullOr(text(200)),
});

const field = <S extends Schema.Constraint>(value: S) =>
  Schema.Union([
    Schema.Struct({
      _tag: Schema.Literal("Unanswered"),
      reopenedBy: OptionalEvidence,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Answered"),
      evidence: PrivateDiscoveryEvidence,
      reopenedBy: OptionalEvidence,
      value,
    }),
    Schema.Struct({
      _tag: Schema.Literal("NoInformation"),
      evidence: PrivateDiscoveryEvidence,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Declined"),
      evidence: PrivateDiscoveryEvidence,
    }),
  ]);
const DescribedField = field(text(200));
const OptionField = field(MealFallbackOption);
const NeedDisposition = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Active"),
    reopenedBy: OptionalEvidence,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Declined"),
    evidence: PrivateDiscoveryEvidence,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Withdrawn"),
    evidence: PrivateDiscoveryEvidence,
  }),
]);
export const MealFallbackNeed = Schema.Struct({
  acceptableOption: OptionField,
  declaration: PrivateDiscoveryEvidence,
  disposition: NeedDisposition,
  extraPreparation: DescribedField,
  id: NeedId,
  reason: DescribedField,
  subject: Subject,
  subjectEvidence: PrivateDiscoveryEvidence,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type MealFallbackNeed = typeof MealFallbackNeed.Type;
export const MealFallbackNeeds = Schema.Array(MealFallbackNeed).pipe(
  Schema.check(
    Schema.isMaxLength(PRIVATE_DISCOVERY_FALLBACK_NEED_LIMIT),
    Schema.makeFilter(
      (needs) => new Set(needs.map((need) => need.id)).size === needs.length,
      { message: "Fallback need IDs must be unique" }
    )
  )
);
export type MealFallbackNeeds = typeof MealFallbackNeeds.Type;

const NeedReference = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Existing"),
    id: NeedId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Declared"),
    index: Schema.Int.pipe(
      Schema.check(Schema.isBetween({ maximum: 2, minimum: 0 }))
    ),
  }),
]).pipe(Schema.annotate({ identifier: "MealFallbackNeedReference" }));
const FieldName = Schema.Literals([
  "reason",
  "acceptableOption",
  "extraPreparation",
]);
type FieldName = typeof FieldName.Type;
const updateFields = {
  evidence: PrivateDiscoveryEvidence,
  need: NeedReference,
};
const answerFields = {
  ...updateFields,
  revisit: OptionalEvidence,
};
export const MealFallbackNeedUpdates = Schema.Struct({
  declarations: Schema.Array(
    Schema.Struct({ evidence: PrivateDiscoveryEvidence, subject: Subject })
  ).pipe(
    Schema.check(Schema.isMaxLength(PRIVATE_DISCOVERY_FALLBACK_NEED_LIMIT))
  ),
  updates: Schema.Array(
    Schema.Union([
      Schema.Struct({
        _tag: Schema.Literal("RecordReason"),
        ...answerFields,
        value: text(200),
      }),
      Schema.Struct({
        _tag: Schema.Literal("RecordOption"),
        ...answerFields,
        value: MealFallbackOption,
      }),
      Schema.Struct({
        _tag: Schema.Literal("RecordPreparation"),
        ...answerFields,
        value: text(200),
      }),
      Schema.Struct({
        _tag: Schema.Literal("SetFieldDisposition"),
        ...updateFields,
        disposition: Schema.Literals(["no_information", "declined"]),
        field: FieldName,
      }),
      Schema.Struct({
        _tag: Schema.Literal("ReopenField"),
        ...updateFields,
        field: FieldName,
      }),
      Schema.Struct({
        _tag: Schema.Literal("SetNeedDisposition"),
        ...updateFields,
        disposition: Schema.Literals(["active", "declined", "withdrawn"]),
      }),
      Schema.Struct({
        _tag: Schema.Literal("CorrectSubject"),
        ...updateFields,
        subject: Subject,
      }),
    ])
  ).pipe(
    Schema.check(Schema.isMaxLength(PRIVATE_DISCOVERY_FALLBACK_UPDATE_LIMIT))
  ),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type MealFallbackNeedUpdates = typeof MealFallbackNeedUpdates.Type;

export class PrivateDiscoveryNeedFailure extends Data.TaggedError(
  "PrivateDiscoveryNeedFailure"
)<{
  readonly stage: "need_evidence" | "need_updates" | "need_limit";
}> {}
const fail = (stage: PrivateDiscoveryNeedFailure["stage"]): never => {
  throw new PrivateDiscoveryNeedFailure({ stage });
};

/** A matching excerpt establishes provenance, not the meaning of an extraction. */
export const assertCurrentParticipantEvidence = (
  evidence: Evidence,
  participant: PrivateDiscoveryEvidenceMessage
): void => {
  if (
    participant.role !== "participant" ||
    evidence.messageId !== participant.id ||
    evidence.quote.trim().length === 0 ||
    !participant.text.includes(evidence.quote)
  ) {
    fail("need_evidence");
  }
};

const unanswered = (reopenedBy: Evidence | null = null) => ({
  _tag: "Unanswered" as const,
  reopenedBy,
});
type AnyField = MealFallbackNeed[FieldName];
const answered = <T>(
  previous: AnyField,
  value: T,
  evidence: Evidence,
  revisit: Evidence | null,
  participant: PrivateDiscoveryEvidenceMessage
) => {
  if ((previous._tag === "Declined") !== (revisit !== null)) {
    fail("need_updates");
  }
  if (revisit !== null) {
    assertCurrentParticipantEvidence(revisit, participant);
  }
  return {
    _tag: "Answered" as const,
    evidence,
    reopenedBy:
      revisit ??
      (previous._tag === "Unanswered" || previous._tag === "Answered"
        ? previous.reopenedBy
        : null),
    value,
  };
};
const replaceFieldDisposition = (
  need: MealFallbackNeed,
  name: FieldName,
  value: Exclude<AnyField, { readonly _tag: "Answered" }>
): MealFallbackNeed => {
  switch (name) {
    case "reason": {
      return { ...need, reason: value };
    }
    case "acceptableOption": {
      return { ...need, acceptableOption: value };
    }
    case "extraPreparation": {
      return { ...need, extraPreparation: value };
    }
    default: {
      return name satisfies never;
    }
  }
};
const updateTarget = (update: MealFallbackNeedUpdates["updates"][number]) => {
  switch (update._tag) {
    case "RecordReason": {
      return "reason";
    }
    case "RecordOption": {
      return "acceptableOption";
    }
    case "RecordPreparation": {
      return "extraPreparation";
    }
    case "SetFieldDisposition":
    case "ReopenField": {
      return update.field;
    }
    case "SetNeedDisposition": {
      return "disposition";
    }
    case "CorrectSubject": {
      return "subject";
    }
    default: {
      return update satisfies never;
    }
  }
};

const needDisposition = (
  disposition: "active" | "declined" | "withdrawn",
  evidence: Evidence
): MealFallbackNeed["disposition"] => {
  switch (disposition) {
    case "active": {
      return { _tag: "Active", reopenedBy: evidence };
    }
    case "declined": {
      return { _tag: "Declined", evidence };
    }
    case "withdrawn": {
      return { _tag: "Withdrawn", evidence };
    }
    default: {
      return disposition satisfies never;
    }
  }
};

const applyNeedUpdate = (
  need: MealFallbackNeed,
  update: MealFallbackNeedUpdates["updates"][number],
  participant: PrivateDiscoveryEvidenceMessage
): MealFallbackNeed => {
  if (
    need.disposition._tag !== "Active" &&
    update._tag !== "SetNeedDisposition"
  ) {
    fail("need_updates");
  }
  switch (update._tag) {
    case "RecordReason": {
      return {
        ...need,
        reason: answered(
          need.reason,
          update.value,
          update.evidence,
          update.revisit,
          participant
        ),
      };
    }
    case "RecordOption": {
      return {
        ...need,
        acceptableOption: answered(
          need.acceptableOption,
          update.value,
          update.evidence,
          update.revisit,
          participant
        ),
      };
    }
    case "RecordPreparation": {
      return {
        ...need,
        extraPreparation: answered(
          need.extraPreparation,
          update.value,
          update.evidence,
          update.revisit,
          participant
        ),
      };
    }
    case "SetFieldDisposition": {
      const value =
        update.disposition === "declined"
          ? { _tag: "Declined" as const, evidence: update.evidence }
          : { _tag: "NoInformation" as const, evidence: update.evidence };
      if (need[update.field]._tag === "Declined" && value._tag !== "Declined") {
        fail("need_updates");
      }
      return replaceFieldDisposition(need, update.field, value);
    }
    case "ReopenField": {
      if (need[update.field]._tag === "Unanswered") {
        fail("need_updates");
      }
      return replaceFieldDisposition(
        need,
        update.field,
        unanswered(update.evidence)
      );
    }
    case "SetNeedDisposition": {
      const disposition = needDisposition(update.disposition, update.evidence);
      if (need.disposition._tag === disposition._tag) {
        fail("need_updates");
      }
      return { ...need, disposition };
    }
    case "CorrectSubject": {
      return {
        ...need,
        subject: update.subject,
        subjectEvidence: update.evidence,
      };
    }
    default: {
      return update satisfies never;
    }
  }
};

/** App IDs and ordered replacement make this transition reproducible outside storage. */
export const applyMealFallbackNeedUpdates = (
  current: MealFallbackNeeds,
  changes: MealFallbackNeedUpdates,
  participant: PrivateDiscoveryEvidenceMessage
): MealFallbackNeeds => {
  if (
    changes.declarations.length > PRIVATE_DISCOVERY_FALLBACK_NEED_LIMIT ||
    changes.updates.length > PRIVATE_DISCOVERY_FALLBACK_UPDATE_LIMIT
  ) {
    fail("need_updates");
  }
  const needs = new Map(current.map((need) => [need.id, need]));
  const declarationEvidence = new Set(
    current.map((need) =>
      JSON.stringify([
        need.subject,
        need.declaration.messageId,
        need.declaration.quote,
      ])
    )
  );
  const declaredIds: string[] = [];
  for (const [index, declaration] of changes.declarations.entries()) {
    assertCurrentParticipantEvidence(declaration.evidence, participant);
    const id = `${participant.id}:${index}`;
    const identity = JSON.stringify([
      declaration.subject,
      declaration.evidence.messageId,
      declaration.evidence.quote,
    ]);
    if (needs.has(id) || declarationEvidence.has(identity)) {
      fail("need_updates");
    }
    declarationEvidence.add(identity);
    declaredIds.push(id);
    needs.set(id, {
      acceptableOption: unanswered(),
      declaration: declaration.evidence,
      disposition: { _tag: "Active", reopenedBy: null },
      extraPreparation: unanswered(),
      id,
      reason: unanswered(),
      subject: declaration.subject,
      subjectEvidence: declaration.evidence,
    });
  }
  if (needs.size > PRIVATE_DISCOVERY_FALLBACK_NEED_LIMIT) {
    fail("need_limit");
  }
  const changed = new Set<string>();
  for (const update of changes.updates) {
    assertCurrentParticipantEvidence(update.evidence, participant);
    const id =
      update.need._tag === "Existing"
        ? update.need.id
        : declaredIds[update.need.index];
    const need = id === undefined ? undefined : needs.get(id);
    if (need === undefined || id === undefined) {
      return fail("need_updates");
    }
    const target = `${id}:${updateTarget(update)}`;
    if (changed.has(target)) {
      fail("need_updates");
    }
    changed.add(target);
    needs.set(id, applyNeedUpdate(need, update, participant));
  }
  return [...needs.values()];
};

export const selectMealFallbackQuestion = (needs: MealFallbackNeeds) => {
  for (const need of needs) {
    if (need.disposition._tag !== "Active") {
      continue;
    }
    if (need.reason._tag === "Unanswered") {
      return {
        fields: ["reason" as const],
        needId: need.id,
        question: `For ${need.subject}, why is an alternative meal needed?`,
      };
    }
    const option = need.acceptableOption._tag === "Unanswered";
    const preparation = need.extraPreparation._tag === "Unanswered";
    if (option && preparation) {
      return {
        fields: ["acceptableOption" as const, "extraPreparation" as const],
        needId: need.id,
        question: `For ${need.subject}, what alternative meal is acceptable, and how much extra preparation is manageable?`,
      };
    }
    if (option) {
      return {
        fields: ["acceptableOption" as const],
        needId: need.id,
        question: `For ${need.subject}, what alternative meal is acceptable?`,
      };
    }
    if (preparation) {
      return {
        fields: ["extraPreparation" as const],
        needId: need.id,
        question: `For ${need.subject}, how much extra preparation is manageable for the alternative meal?`,
      };
    }
  }
  return null;
};
