import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyPrivateDiscoveryContinuation,
  emptyPrivateDiscoveryContinuity,
  emptyPrivateDiscoveryContinuityUpdates,
  PrivateDiscoveryContinuity,
  PrivateDiscoveryContinuityJson,
  PrivateDiscoveryContinuityNote,
  PrivateDiscoveryContinuityUpdates,
  PrivateDiscoveryReply,
} from "./private-discovery-continuity.js";

const participant = {
  id: crypto.randomUUID(),
  role: "participant" as const,
  text: "Please stop asking questions.",
};
const note = (
  key: string,
  state: typeof PrivateDiscoveryContinuityNote.Type.state = "circumstance",
  question = "What matters here?"
) => {
  const value = {
    detail: "The adult disclosed useful meal context.",
    key,
    state,
    subject: `Topic ${key}`,
  };
  return Schema.decodeUnknownSync(PrivateDiscoveryContinuityNote)(
    state === "unresolved" ? { ...value, question } : value
  );
};
const state = (...notes: (typeof PrivateDiscoveryContinuityNote.Type)[]) => ({
  ...emptyPrivateDiscoveryContinuity(),
  notes,
});
const updates = (...notes: (typeof PrivateDiscoveryContinuityNote.Type)[]) => ({
  ...emptyPrivateDiscoveryContinuityUpdates(),
  notes,
});
const continuation = Schema.decodeUnknownSync(PrivateDiscoveryReply)({
  _tag: "Continue",
});
const apply = (
  current: PrivateDiscoveryContinuity,
  changes: typeof PrivateDiscoveryContinuityUpdates.Type,
  reply = continuation
) =>
  applyPrivateDiscoveryContinuation(current, changes, reply, participant, []);

describe("private discovery continuity and reply policy", () => {
  it("retains omitted circumstances while closing an answered topic and removing its question", () => {
    const routine = note("routine");
    const pending = note("preferences", "unresolved");
    const answered = {
      ...note("preferences", "answered"),
      detail: "The adult prefers roasted vegetables.",
    };
    const result = apply(state(routine, pending), updates(answered));
    expect(result.continuity).toEqual(state(routine, answered));
    expect(result.continuity.notes[1]).not.toHaveProperty("question");
    expect(result.decision).toEqual({ _tag: "Review" });
    expect(result.message).toBe(
      "You can finish this conversation when you're ready."
    );
  });

  it("corrects a question in place and selects retained order before newly appended topics", () => {
    const first = note(
      "equipment",
      "unresolved",
      "Which equipment do you have?"
    );
    const retained = note("routine");
    const corrected = note("equipment", "unresolved", "Does your hob work?");
    const next = note("schedule", "unresolved", "Which evenings are busy?");
    const result = apply(state(retained, first), updates(next, corrected));
    expect(result.continuity).toEqual(state(retained, corrected, next));
    expect(result.decision).toEqual({
      _tag: "Ask",
      question: "Does your hob work?",
      source: { _tag: "Note", key: "equipment" },
    });
    const settled = note("equipment", "answered");
    const afterAnswer = apply(result.continuity, updates(settled));
    expect(afterAnswer.message).toBe("Which evenings are busy?");
    expect(afterAnswer.continuity).toEqual(state(retained, settled, next));
  });

  it.each(["answered", "no_information", "declined", "withdrawn"] as const)(
    "retains %s without silently asking its former question again",
    (status) => {
      const pending = note("topic", "unresolved");
      const closed = note("topic", status);
      const result = apply(state(pending), updates(closed));
      expect(result.continuity).toEqual(state(closed));
      expect(apply(result.continuity, updates()).decision).toEqual({
        _tag: "Review",
      });
      expect(result.message).not.toContain("What matters here?");
    }
  );

  it("retains the sole unresolved question through codec round-trip and omission", () => {
    const pending = note(
      "routine",
      "unresolved",
      "Which part depends on your routine?"
    );
    const initial = apply(state(), updates(pending));
    const restored = Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(
      Schema.encodeSync(PrivateDiscoveryContinuityJson)(initial.continuity)
    );
    const resumed = apply(restored, updates());
    expect(resumed.continuity).toEqual(state(pending));
    expect(resumed.message).toBe("Which part depends on your routine?");
    expect(resumed.decision).toEqual(initial.decision);
  });

  it.each([
    {
      changes: updates(note("a"), note("a")),
      current: state(),
      title: "duplicate new keys",
    },
    {
      changes: updates(note("a"), {
        ...note("a"),
        detail: "Different update.",
      }),
      current: state(note("a")),
      title: "duplicate retained keys",
    },
    {
      changes: updates(...Array.from({ length: 7 }, (_, i) => note(`n${i}`))),
      current: state(),
      title: "seven note updates",
    },
  ])("rejects $title without mutating input", ({ current, changes }) => {
    const before = JSON.stringify(current);
    expect(() => apply(current, changes)).toThrow(
      expect.objectContaining({ stage: "continuity_updates" })
    );
    expect(JSON.stringify(current)).toBe(before);
  });

  it("requires current participant stop evidence and preserves the exact snapshot", () => {
    const current = state(note("topic", "unresolved"));
    const reply = {
      _tag: "Stop" as const,
      evidence: { messageId: participant.id, quote: participant.text },
    };
    expect(apply(current, updates(), reply)).toEqual({
      continuity: current,
      decision: { _tag: "Stop" },
      message: "We can stop here.",
    });
    expect(() => apply(current, updates(note("new")), reply)).toThrow(
      expect.objectContaining({ stage: "reply_decision" })
    );
    expect(() =>
      apply(current, updates(), {
        ...reply,
        evidence: { messageId: crypto.randomUUID(), quote: participant.text },
      })
    ).toThrow(expect.objectContaining({ stage: "need_evidence" }));
  });

  it("allows a complete question at the message bound and rejects an oversized question", () => {
    const current = state(note("topic", "unresolved", "q".repeat(2000)));
    expect(apply(current, updates()).message).toHaveLength(2000);
    expect(() => note("topic", "unresolved", "q".repeat(2001))).toThrow();
  });

  it("retains twelve notes and rejects a thirteenth without eviction", () => {
    const current = state(
      ...Array.from({ length: 12 }, (_, i) => note(`n${i}`))
    );
    expect(apply(current, updates()).continuity).toEqual(current);
    expect(() => apply(current, updates(note("extra")))).toThrow(
      expect.objectContaining({ stage: "continuity_limit" })
    );
  });

  it("checks the complete snapshot UTF-8 size even when individual fields fit", () => {
    const large = (i: number) => ({
      ...note(`n${i}`),
      detail: "🍲".repeat(100),
      subject: "🍲".repeat(60),
    });
    expect(() =>
      apply(
        state(...Array.from({ length: 6 }, (_, i) => large(i))),
        updates(...Array.from({ length: 6 }, (_, i) => large(i + 6)))
      )
    ).toThrow(expect.objectContaining({ stage: "continuity_limit" }));
  });

  it("uses one strict snapshot codec and rejects obsolete or malformed state", () => {
    const current = state(note("routine"), note("topic", "no_information"));
    expect(
      Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(
        Schema.encodeSync(PrivateDiscoveryContinuityJson)(current)
      )
    ).toEqual(current);
    for (const stored of [
      "Previous free-text summary",
      "null",
      "[]",
      JSON.stringify(state(note("a"), note("a"))),
      JSON.stringify({ ...current, householdId: "forbidden" }),
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(stored)
      ).toThrow();
    }
  });

  it.each([
    { ...note("a"), key: "k".repeat(33) },
    { ...note("a"), subject: "s".repeat(121) },
    { ...note("a"), detail: "d".repeat(201) },
    { ...note("a"), state: "unresolved" },
    { ...note("a"), question: "", state: "unresolved" },
    {
      ...note("a"),
      question: "A settled circumstance cannot carry a question.",
    },
    {
      ...note("a", "answered"),
      question: "A settled answer cannot carry a question.",
    },
  ])("rejects an invalid note field or question ownership", (invalid) => {
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryContinuityNote)(invalid)
    ).toThrow();
  });

  it("rejects excess notes, updates, unknown fields and removed model reply fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryContinuity)(
        state(...Array.from({ length: 13 }, (_, i) => note(`n${i}`)))
      )
    ).toThrow();
    for (const invalid of [
      updates(...Array.from({ length: 7 }, (_, i) => note(`n${i}`))),
      { additions: [note("a")], revisions: [] },
      [note("a")],
      { ...updates(), actor: "forbidden" },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(PrivateDiscoveryContinuityUpdates)(invalid)
      ).toThrow();
    }
    for (const invalid of [
      { _tag: "Continue", text: "A model-authored persistence claim." },
      { _tag: "Continue", followUp: null },
      {
        _tag: "Continue",
        followUp: { question: "What matters?", topicKey: "topic" },
      },
      {
        _tag: "Stop",
        evidence: { messageId: participant.id, quote: participant.text },
        text: "A model-authored stop claim.",
      },
      { _tag: "Review", reason: "no_relevant_open_topic" },
      { _tag: "Ask", question: "What matters?", topicKey: "topic" },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(PrivateDiscoveryReply)(invalid)
      ).toThrow();
    }
  });
});
