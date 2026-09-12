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
  state: typeof PrivateDiscoveryContinuityNote.Type.state = "circumstance"
) =>
  Schema.decodeUnknownSync(PrivateDiscoveryContinuityNote)({
    detail: "The adult disclosed useful meal context.",
    key,
    state,
    subject: `Topic ${key}`,
  });
const state = (...notes: (typeof PrivateDiscoveryContinuityNote.Type)[]) => ({
  ...emptyPrivateDiscoveryContinuity(),
  notes,
});
const updates = (...notes: (typeof PrivateDiscoveryContinuityNote.Type)[]) => ({
  ...emptyPrivateDiscoveryContinuityUpdates(),
  notes,
});
const acknowledgment = Schema.decodeUnknownSync(PrivateDiscoveryReply)({
  _tag: "Continue",
  followUp: null,
  text: "Your cards are available for review.",
});
const ask = (
  topicKey: string,
  text = "Thank you.",
  question = "What matters here?"
) =>
  Schema.decodeUnknownSync(PrivateDiscoveryReply)({
    _tag: "Continue",
    followUp: { question, topicKey },
    text,
  });
const apply = (
  current: PrivateDiscoveryContinuity,
  changes: typeof PrivateDiscoveryContinuityUpdates.Type,
  reply = acknowledgment
) => applyPrivateDiscoveryContinuation(current, changes, reply, participant);

describe("private discovery continuity and reply policy", () => {
  it("retains omitted circumstances while an unrelated topic is answered", () => {
    const routine = note("routine");
    const topic = note("preferences", "unresolved");
    const answered = {
      ...topic,
      detail: "The adult prefers roasted vegetables.",
      state: "answered" as const,
    };
    const result = apply(state(routine, topic), updates(answered));
    expect(result.continuity).toEqual(state(routine, answered));
    expect(result.decision).toEqual({ _tag: "Review" });
    expect(result.message).toBe(acknowledgment.text);
  });

  it("corrects one note while preserving other notes and insertion order", () => {
    const previous = note("equipment", "unresolved");
    const retained = note("routine");
    const omitted = note("capacity");
    const corrected = {
      ...previous,
      detail: "The adult has a hob.",
      state: "answered" as const,
      subject: "Available hob",
    };
    const added = note("schedule");
    const next = note("exceptions", "unresolved");
    const result = apply(
      state(retained, previous, omitted),
      updates(added, corrected, next),
      ask(next.key)
    );
    expect(result.continuity).toEqual(
      state(retained, corrected, omitted, added, next)
    );
    expect(result.decision).toEqual({
      _tag: "Ask",
      question: "What matters here?",
      source: { _tag: "Note", key: next.key },
    });
  });

  it.each(["answered", "no_information", "declined", "withdrawn"] as const)(
    "retains %s without allowing a generic question to reopen it",
    (status) => {
      const pending = note("topic", "unresolved");
      const closed = { ...pending, state: status };
      const result = apply(state(pending), updates(closed));
      expect(result.continuity).toEqual(state(closed));
      expect(() => apply(result.continuity, updates(), ask("topic"))).toThrow(
        expect.objectContaining({ stage: "reply_decision" })
      );
    }
  );

  it("selects a valid generic question for a new or retained unresolved note", () => {
    const pending = note("topic", "unresolved");
    for (const current of [state(), state(pending)]) {
      const result = apply(
        current,
        current.notes.length === 0 ? updates(pending) : updates(),
        ask(
          "topic",
          "Please review the draft.",
          "Which part depends on your routine?"
        )
      );
      expect(result.message).toBe(
        "Please review the draft.\n\nWhich part depends on your routine?"
      );
      expect(result.continuity).toEqual(state(pending));
    }
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

  it("rejects missing generic follow-up while a note remains unresolved", () => {
    expect(() => apply(state(note("open", "unresolved")), updates())).toThrow(
      expect.objectContaining({ stage: "reply_decision" })
    );
    expect(() => apply(state(), updates(), ask("missing"))).toThrow(
      expect.objectContaining({ stage: "reply_decision" })
    );
    expect(() =>
      apply(state(note("context")), updates(), ask("context"))
    ).toThrow(expect.objectContaining({ stage: "reply_decision" }));
  });

  it("requires current participant stop evidence and preserves the exact snapshot", () => {
    const current = state(note("topic", "unresolved"));
    const reply = {
      _tag: "Stop" as const,
      evidence: { messageId: participant.id, quote: participant.text },
      text: "We can stop here.",
    };
    expect(apply(current, updates(), reply)).toEqual({
      continuity: current,
      decision: { _tag: "Stop" },
      message: reply.text,
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

  it("enforces the combined rendered length including the separator", () => {
    const current = state(note("topic", "unresolved"));
    expect(
      apply(current, updates(), ask("topic", "a".repeat(1000), "q".repeat(998)))
        .message
    ).toHaveLength(2000);
    expect(() =>
      apply(current, updates(), ask("topic", "a".repeat(1000), "q".repeat(999)))
    ).toThrow(expect.objectContaining({ stage: "reply_limit" }));
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
    const encoded = Schema.encodeSync(PrivateDiscoveryContinuityJson)(current);
    expect(
      Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(encoded)
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
  ])("rejects an oversized note field", (invalid) => {
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryContinuityNote)(invalid)
    ).toThrow();
  });

  it("rejects excess notes, updates, unknown fields and the old model-owned reply shape", () => {
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
      { _tag: "Review", reason: "no_relevant_open_topic", text: "Done." },
      {
        _tag: "Ask",
        question: "What matters?",
        text: "Thanks.",
        topicKey: "topic",
      },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(PrivateDiscoveryReply)(invalid)
      ).toThrow();
    }
  });
});
