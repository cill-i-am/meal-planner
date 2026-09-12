import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { PrivateDiscoveryContinuity } from "./private-discovery-continuity.js";
import {
  applyPrivateDiscoveryContinuation,
  emptyPrivateDiscoveryContinuity,
  emptyPrivateDiscoveryContinuityUpdates,
  PrivateDiscoveryContinuityJson,
  PrivateDiscoveryContinuityUpdates,
  PrivateDiscoveryReply,
} from "./private-discovery-continuity.js";
import {
  MealFallbackNeedUpdates,
  PrivateDiscoveryEvidenceMessage,
} from "./private-discovery-needs.js";

const source = (
  text = "Jordan needs an alternative because dinner is too spicy. A plain sandwich works, one serving, and I can assemble it without cooking."
) =>
  Schema.decodeUnknownSync(PrivateDiscoveryEvidenceMessage)({
    id: crypto.randomUUID(),
    role: "participant",
    text,
  });
const evidence = (
  participant: PrivateDiscoveryEvidenceMessage,
  quote = participant.text
) => ({ messageId: participant.id, quote });
const declared = { _tag: "Declared" as const, index: 0 };
const existing = (id: string) => ({ _tag: "Existing" as const, id });
const option = {
  description: "a plain sandwich",
  kind: "generic" as const,
  quantity: "one serving",
  substitutions: null,
};
const continueReply = Schema.decodeUnknownSync(PrivateDiscoveryReply)({
  _tag: "Continue",
  followUp: null,
  text: "I have retained what you described.",
});
type Update = MealFallbackNeedUpdates["updates"][number];
type Reference = Update["need"];
const reason = (
  participant: PrivateDiscoveryEvidenceMessage,
  need: Reference = declared
): Update => ({
  _tag: "RecordReason",
  evidence: evidence(participant),
  need,
  revisit: null,
  value: "The shared meal is too spicy.",
});
const acceptedOption = (
  participant: PrivateDiscoveryEvidenceMessage,
  need: Reference = declared
): Update => ({
  _tag: "RecordOption",
  evidence: evidence(participant),
  need,
  revisit: null,
  value: option,
});
const preparation = (
  participant: PrivateDiscoveryEvidenceMessage,
  need: Reference = declared
): Update => ({
  _tag: "RecordPreparation",
  evidence: evidence(participant),
  need,
  revisit: null,
  value: "Assembling without additional cooking is manageable.",
});
const changes = (
  participant: PrivateDiscoveryEvidenceMessage,
  updates: readonly Update[] = [],
  declare = false
) => ({
  ...emptyPrivateDiscoveryContinuityUpdates(),
  mealFallbackNeeds: {
    declarations: declare
      ? [{ evidence: evidence(participant), subject: "Jordan" }]
      : [],
    updates,
  },
});
const run = (
  current: PrivateDiscoveryContinuity,
  updates: typeof PrivateDiscoveryContinuityUpdates.Type,
  participant: PrivateDiscoveryEvidenceMessage,
  reply = continueReply
) => applyPrivateDiscoveryContinuation(current, updates, reply, participant);
const start = (
  participant: PrivateDiscoveryEvidenceMessage,
  updates: readonly Update[] = []
) =>
  run(
    emptyPrivateDiscoveryContinuity(),
    changes(participant, updates, true),
    participant
  );
const needId = (participant: PrivateDiscoveryEvidenceMessage) =>
  `${participant.id}:0`;

describe("typed private meal fallback needs", () => {
  it("initializes all fields and deterministically asks the cause of a declaration-only need", () => {
    const participant = source(
      "Jordan needs an easy alternative on shared-meal nights."
    );
    const first = start(participant);
    expect(first).toEqual(start(participant));
    expect(first.continuity.mealFallbackNeeds).toMatchObject([
      {
        acceptableOption: { _tag: "Unanswered" },
        extraPreparation: { _tag: "Unanswered" },
        id: needId(participant),
        reason: { _tag: "Unanswered" },
      },
    ]);
    expect(first.decision).toEqual({
      _tag: "Ask",
      question: "For Jordan, why is an alternative meal needed?",
      source: {
        _tag: "MealFallbackNeed",
        fields: ["reason"],
        needId: needId(participant),
      },
    });
  });

  it("keeps a declared need open when an unrelated adult safety topic is answered", () => {
    const opening = source();
    const before = start(opening).continuity;
    const participant = source("I have no known hard food constraints.");
    const result = run(
      before,
      {
        ...changes(participant),
        notes: [
          {
            detail: participant.text,
            key: "adult_safety",
            state: "answered",
            subject: "Adult safety",
          },
        ],
      },
      participant
    );
    expect(result.continuity.mealFallbackNeeds).toEqual(
      before.mealFallbackNeeds
    );
    expect(result.decision).toMatchObject({
      _tag: "Ask",
      source: { fields: ["reason"] },
    });
  });

  it("asks option and preparation together after the reason is known", () => {
    const participant = source();
    const result = start(participant, [reason(participant)]);
    expect(result.decision).toMatchObject({
      _tag: "Ask",
      source: { fields: ["acceptableOption", "extraPreparation"] },
    });
    expect(result.message).toBe(
      "I have retained what you described.\n\nFor Jordan, what alternative meal is acceptable, and how much extra preparation is manageable?"
    );
  });

  it.each(["acceptableOption", "extraPreparation"] as const)(
    "asks only the remaining field after %s is known",
    (known) => {
      const participant = source();
      const result = start(participant, [
        reason(participant),
        known === "acceptableOption"
          ? acceptedOption(participant)
          : preparation(participant),
      ]);
      expect(result.decision).toMatchObject({
        _tag: "Ask",
        source: {
          fields: [
            known === "acceptableOption"
              ? "extraPreparation"
              : "acceptableOption",
          ],
        },
      });
    }
  );

  it("accepts initially complete generic answers without requesting a product or repeating questions", () => {
    const participant = source();
    const result = start(participant, [
      reason(participant),
      acceptedOption(participant),
      preparation(participant),
    ]);
    expect(result.decision).toEqual({ _tag: "Review" });
    expect(
      result.continuity.mealFallbackNeeds[0]?.acceptableOption
    ).toMatchObject({
      _tag: "Answered",
      evidence: evidence(participant),
      value: option,
    });
  });

  it("retains all omitted fields through the canonical persisted codec and a later unrelated message", () => {
    const opening = source();
    const first = start(opening, [reason(opening)]);
    const restored = Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(
      Schema.encodeSync(PrivateDiscoveryContinuityJson)(first.continuity)
    );
    const participant = source("Nothing else about my own preferences.");
    const next = run(restored, changes(participant), participant);
    expect(next.continuity).toEqual(first.continuity);
    expect(next.decision).toEqual(first.decision);
  });

  it("preserves exact product identity and quantity when current evidence tightens substitution scope", () => {
    const opening = source(
      "Jordan needs an alternative because the meal is too spicy. One Harbor plain soup cup works, and assembly needs no additional cooking."
    );
    const exact = {
      description: "Harbor plain soup cup",
      kind: "exact" as const,
      quantity: "one cup",
      substitutions: null,
    };
    const first = start(opening, [
      reason(opening),
      {
        _tag: "RecordOption",
        evidence: evidence(opening),
        need: declared,
        revisit: null,
        value: exact,
      },
      preparation(opening),
    ]);
    const participant = source(
      "Keep that exact cup, not a generic alternative."
    );
    const updated = run(
      first.continuity,
      changes(participant, [
        {
          _tag: "RecordOption",
          evidence: evidence(participant),
          need: existing(needId(opening)),
          revisit: null,
          value: { ...exact, substitutions: "No generic alternative." },
        },
      ]),
      participant
    );
    expect(updated.continuity.mealFallbackNeeds[0]).toMatchObject({
      acceptableOption: {
        _tag: "Answered",
        evidence: evidence(participant),
        value: { ...exact, substitutions: "No generic alternative." },
      },
      declaration: evidence(opening),
      id: needId(opening),
    });
    expect(updated.decision).toEqual({ _tag: "Review" });
  });

  it.each(["no_information", "declined"] as const)(
    "closes only the named field as %s without turning it into an answer",
    (disposition) => {
      const participant = source(
        disposition === "declined"
          ? "The shared meal is too spicy. I do not want to discuss which alternative works."
          : "The shared meal is too spicy. I have no information about which alternative works."
      );
      const first = start(participant, [
        reason(participant),
        {
          _tag: "SetFieldDisposition",
          disposition,
          evidence: evidence(participant),
          field: "acceptableOption",
          need: declared,
          revisit: null,
        },
      ]);
      expect(first.decision).toMatchObject({
        _tag: "Ask",
        source: { fields: ["extraPreparation"] },
      });
      expect(first.continuity.mealFallbackNeeds[0]?.acceptableOption._tag).toBe(
        disposition === "declined" ? "Declined" : "NoInformation"
      );
      const next = source("No additional cooking is manageable.");
      const resolved = run(
        first.continuity,
        changes(next, [preparation(next, existing(needId(participant)))]),
        next
      );
      expect(resolved.decision).toEqual({ _tag: "Review" });
      expect(
        resolved.continuity.mealFallbackNeeds[0]?.acceptableOption
      ).not.toHaveProperty("value");
    }
  );

  it("requires separate current revisit evidence before answering a declined field", () => {
    const opening = source(
      "The shared meal is too spicy. I do not want to discuss which alternative works."
    );
    const first = start(opening, [
      reason(opening),
      {
        _tag: "SetFieldDisposition",
        disposition: "declined",
        evidence: evidence(opening),
        field: "acceptableOption",
        need: declared,
        revisit: null,
      },
    ]);
    const participant = source(
      "I want to revisit that choice. A plain sandwich is fine."
    );
    const answer = acceptedOption(participant, existing(needId(opening)));
    expect(() =>
      run(first.continuity, changes(participant, [answer]), participant)
    ).toThrow(expect.objectContaining({ stage: "need_updates" }));
    if (answer._tag !== "RecordOption") {
      throw new Error("Expected option update");
    }
    const result = run(
      first.continuity,
      changes(participant, [
        {
          ...answer,
          revisit: evidence(participant, "I want to revisit that choice."),
        },
      ]),
      participant
    );
    expect(
      result.continuity.mealFallbackNeeds[0]?.acceptableOption
    ).toMatchObject({
      _tag: "Answered",
      reopenedBy: evidence(participant, "I want to revisit that choice."),
    });
  });

  it("atomically revisits a declined field with no information without asking it again", () => {
    const opening = source(
      "The shared meal is too spicy. I decline to discuss the alternative. No extra cooking is manageable."
    );
    const first = start(opening, [
      reason(opening),
      preparation(opening),
      {
        _tag: "SetFieldDisposition",
        disposition: "declined",
        evidence: evidence(opening),
        field: "acceptableOption",
        need: declared,
        revisit: null,
      },
    ]);
    const participant = source(
      "I want to revisit the alternative, but I do not know what would work."
    );
    const revisit = evidence(participant, "I want to revisit the alternative");
    const result = run(
      first.continuity,
      changes(participant, [
        {
          _tag: "SetFieldDisposition",
          disposition: "no_information",
          evidence: evidence(participant, "I do not know what would work."),
          field: "acceptableOption",
          need: existing(needId(opening)),
          revisit,
        },
      ]),
      participant
    );
    const [previous] = first.continuity.mealFallbackNeeds;
    expect(result.continuity.mealFallbackNeeds).toEqual([
      {
        ...previous,
        acceptableOption: {
          _tag: "NoInformation",
          evidence: evidence(participant, "I do not know what would work."),
          reopenedBy: revisit,
        },
      },
    ]);
    expect(result.decision).toEqual({ _tag: "Review" });
    const next = source("A plain sandwich would work after all.");
    const answered = run(
      result.continuity,
      changes(next, [acceptedOption(next, existing(needId(opening)))]),
      next
    );
    expect(
      answered.continuity.mealFallbackNeeds[0]?.acceptableOption
    ).toMatchObject({
      _tag: "Answered",
      reopenedBy: revisit,
    });
  });

  it.each(["absent", "stale", "mismatched"] as const)(
    "rejects no-information settlement of a declined field with %s revisit evidence",
    (kind) => {
      const opening = source("I decline to discuss the alternative.");
      const first = start(opening, [
        {
          _tag: "SetFieldDisposition",
          disposition: "declined",
          evidence: evidence(opening),
          field: "acceptableOption",
          need: declared,
          revisit: null,
        },
      ]);
      const participant = source("I do not know what would work.");
      const revisits = {
        absent: null,
        mismatched: evidence(participant, "I want to revisit this."),
        stale: evidence(opening),
      };
      const before = JSON.stringify(first.continuity);
      expect(() =>
        run(
          first.continuity,
          changes(participant, [
            {
              _tag: "SetFieldDisposition",
              disposition: "no_information",
              evidence: evidence(participant),
              field: "acceptableOption",
              need: existing(needId(opening)),
              revisit: revisits[kind],
            },
          ]),
          participant
        )
      ).toThrow(
        expect.objectContaining({
          stage: kind === "absent" ? "need_updates" : "need_evidence",
        })
      );
      expect(JSON.stringify(first.continuity)).toBe(before);
    }
  );

  it("can explicitly reopen a field while retaining its need identity and reopen evidence", () => {
    const opening = source();
    const first = start(opening, [
      reason(opening),
      acceptedOption(opening),
      preparation(opening),
    ]);
    const participant = source(
      "The amount of preparation has changed; I am not sure what works now."
    );
    const result = run(
      first.continuity,
      changes(participant, [
        {
          _tag: "ReopenField",
          evidence: evidence(participant),
          field: "extraPreparation",
          need: existing(needId(opening)),
        },
      ]),
      participant
    );
    expect(result.continuity.mealFallbackNeeds[0]?.extraPreparation).toEqual({
      _tag: "Unanswered",
      reopenedBy: evidence(participant),
    });
    expect(result.decision).toMatchObject({
      _tag: "Ask",
      source: { fields: ["extraPreparation"], needId: needId(opening) },
    });
  });

  it.each(["declined", "withdrawn"] as const)(
    "retains whole-need %s and permits unrelated adult questions",
    (disposition) => {
      const opening = source();
      const first = start(opening);
      const participant = source(
        disposition === "declined"
          ? "I will not discuss Jordan's alternative meal."
          : "Jordan no longer needs an alternative meal."
      );
      const result = run(
        first.continuity,
        {
          ...changes(participant, [
            {
              _tag: "SetNeedDisposition",
              disposition,
              evidence: evidence(participant),
              need: existing(needId(opening)),
            },
          ]),
          notes: [
            {
              detail: "",
              key: "adult_preference",
              state: "unresolved",
              subject: "Adult preference",
            },
          ],
        },
        participant,
        {
          _tag: "Continue",
          followUp: {
            question: "What meal do you enjoy?",
            topicKey: "adult_preference",
          },
          text: "Understood.",
        }
      );
      expect(result.decision).toMatchObject({
        _tag: "Ask",
        source: { _tag: "Note", key: "adult_preference" },
      });
      expect(result.continuity.mealFallbackNeeds[0]).toMatchObject({
        disposition: {
          _tag: disposition === "declined" ? "Declined" : "Withdrawn",
          evidence: evidence(participant),
        },
        reason: { _tag: "Unanswered" },
      });
      expect(() =>
        run(
          result.continuity,
          changes(participant, [
            reason(participant, existing(needId(opening))),
          ]),
          participant
        )
      ).toThrow(expect.objectContaining({ stage: "need_updates" }));
    }
  );

  it("requires explicit need reactivation before its fields can change", () => {
    const opening = source();
    const first = start(opening);
    const refusal = source("I will not discuss that alternative meal.");
    const closed = run(
      first.continuity,
      changes(refusal, [
        {
          _tag: "SetNeedDisposition",
          disposition: "declined",
          evidence: evidence(refusal),
          need: existing(needId(opening)),
        },
      ]),
      refusal
    );
    const participant = source(
      "I want to revisit the alternative meal; the shared dish is too spicy."
    );
    const result = run(
      closed.continuity,
      changes(participant, [
        {
          _tag: "SetNeedDisposition",
          disposition: "active",
          evidence: evidence(participant),
          need: existing(needId(opening)),
        },
        reason(participant, existing(needId(opening))),
      ]),
      participant
    );
    expect(result.decision).toMatchObject({
      _tag: "Ask",
      source: { fields: ["acceptableOption", "extraPreparation"] },
    });
    expect(result.continuity.mealFallbackNeeds[0]?.disposition).toEqual({
      _tag: "Active",
      reopenedBy: evidence(participant),
    });
  });

  it("honors evidenced Stop without changing a pending need", () => {
    const opening = source();
    const current = start(opening).continuity;
    const participant = source("Please stop this interview.");
    const result = run(current, changes(participant), participant, {
      _tag: "Stop",
      evidence: evidence(participant),
      text: "We can stop here.",
    });
    expect(result).toEqual({
      continuity: current,
      decision: { _tag: "Stop" },
      message: "We can stop here.",
    });
  });

  it.each(["older", "unknown", "assistant", "mismatched_excerpt"] as const)(
    "rejects %s evidence without altering retained state",
    (invalid) => {
      const opening = source();
      const current = start(opening).continuity;
      const participant = source("The shared meal is too spicy.");
      const update = reason(participant, existing(needId(opening)));
      const invalidEvidence = {
        assistant: evidence(participant),
        mismatched_excerpt: evidence(
          participant,
          "A statement that was never supplied."
        ),
        older: evidence(opening),
        unknown: { ...evidence(participant), messageId: crypto.randomUUID() },
      };
      const badEvidence = invalidEvidence[invalid];
      const before = JSON.stringify(current);
      expect(() =>
        run(
          current,
          changes(participant, [{ ...update, evidence: badEvidence }]),
          invalid === "assistant"
            ? { ...participant, role: "assistant" }
            : participant
        )
      ).toThrow(expect.objectContaining({ stage: "need_evidence" }));
      expect(JSON.stringify(current)).toBe(before);
    }
  );

  it("rejects literal declaration replay but admits distinct subjects supported by one statement", () => {
    const participant = source("Jordan and Casey both need alternative meals.");
    const declaration = { evidence: evidence(participant), subject: "Jordan" };
    const duplicate = {
      ...changes(participant),
      mealFallbackNeeds: {
        declarations: [declaration, declaration],
        updates: [],
      },
    };
    expect(() =>
      run(emptyPrivateDiscoveryContinuity(), duplicate, participant)
    ).toThrow(expect.objectContaining({ stage: "need_updates" }));
    const distinct = run(
      emptyPrivateDiscoveryContinuity(),
      {
        ...duplicate,
        mealFallbackNeeds: {
          declarations: [declaration, { ...declaration, subject: "Casey" }],
          updates: [],
        },
      },
      participant
    );
    expect(
      distinct.continuity.mealFallbackNeeds.map((need) => need.id)
    ).toEqual([`${participant.id}:0`, `${participant.id}:1`]);
    expect(() =>
      run(distinct.continuity, changes(participant, [], true), participant)
    ).toThrow(expect.objectContaining({ stage: "need_updates" }));
  });

  it("corrects attribution without changing the app-owned ID or declaration evidence", () => {
    const opening = source();
    const first = start(opening);
    const participant = source("I meant Casey, not Jordan.");
    const result = run(
      first.continuity,
      changes(participant, [
        {
          _tag: "CorrectSubject",
          evidence: evidence(participant),
          need: existing(needId(opening)),
          subject: "Casey",
        },
      ]),
      participant
    );
    expect(result.continuity.mealFallbackNeeds[0]).toMatchObject({
      declaration: evidence(opening),
      id: needId(opening),
      subject: "Casey",
      subjectEvidence: evidence(participant),
    });
  });

  it("rejects unknown references and repeated field operations", () => {
    const participant = source();
    expect(() =>
      run(
        emptyPrivateDiscoveryContinuity(),
        changes(participant, [reason(participant, existing("unknown"))]),
        participant
      )
    ).toThrow(expect.objectContaining({ stage: "need_updates" }));
    expect(() =>
      start(participant, [reason(participant), reason(participant)])
    ).toThrow(expect.objectContaining({ stage: "need_updates" }));
  });

  it("validates an emitted generic reference even when a typed question has priority", () => {
    const participant = source();
    expect(() =>
      run(
        emptyPrivateDiscoveryContinuity(),
        changes(participant, [], true),
        participant,
        {
          _tag: "Continue",
          followUp: { question: "What else?", topicKey: "missing" },
          text: "Understood.",
        }
      )
    ).toThrow(expect.objectContaining({ stage: "reply_decision" }));
  });

  it("bounds need count, delta count, unknown fields and evidence excerpts", () => {
    let current = emptyPrivateDiscoveryContinuity();
    for (let i = 0; i < 3; i += 1) {
      const participant = source(`Person ${i} needs an alternative.`);
      current = run(
        current,
        {
          ...changes(participant),
          mealFallbackNeeds: {
            declarations: [
              { evidence: evidence(participant), subject: `Person ${i}` },
            ],
            updates: [],
          },
        },
        participant
      ).continuity;
    }
    const extra = source("Another person needs an alternative.");
    expect(() => run(current, changes(extra, [], true), extra)).toThrow(
      expect.objectContaining({ stage: "need_limit" })
    );
    for (const invalid of [
      {
        declarations: [],
        updates: Array.from({ length: 7 }, () => reason(extra)),
      },
      {
        declarations: [
          { evidence: evidence(extra, "x".repeat(401)), subject: "Jordan" },
        ],
        updates: [],
      },
      { completed: true, declarations: [], updates: [] },
      {
        declarations: [
          { evidence: evidence(extra), id: "model-owned", subject: "Jordan" },
        ],
        updates: [],
      },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(MealFallbackNeedUpdates)(invalid)
      ).toThrow();
    }
  });

  it("rejects combined snapshot byte overflow while every individual delta fits", () => {
    const participant = source("🍲".repeat(200));
    const declarations = Array.from({ length: 3 }, (_, index) => ({
      evidence: evidence(participant),
      subject: `${index}${"🍲".repeat(59)}`,
    }));
    const updates: Update[] = declarations.flatMap((_, index) => [
      {
        _tag: "RecordReason",
        evidence: evidence(participant),
        need: { _tag: "Declared", index },
        revisit: null,
        value: "🍲".repeat(100),
      },
      {
        _tag: "RecordPreparation",
        evidence: evidence(participant),
        need: { _tag: "Declared", index },
        revisit: null,
        value: "🍲".repeat(100),
      },
    ]);
    const delta = Schema.decodeUnknownSync(PrivateDiscoveryContinuityUpdates)({
      mealFallbackNeeds: { declarations, updates },
      notes: [],
    });
    expect(() =>
      run(emptyPrivateDiscoveryContinuity(), delta, participant)
    ).toThrow(expect.objectContaining({ stage: "continuity_limit" }));
  });
});
