import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyPrivateDiscoveryContinuation,
  PrivateDiscoveryContinuity,
  PrivateDiscoveryContinuityJson,
  PrivateDiscoveryContinuityNote,
  PrivateDiscoveryContinuityUpdates,
  PrivateDiscoveryReply,
} from "./private-discovery-continuity.js";

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
const review = Schema.decodeUnknownSync(PrivateDiscoveryReply)({
  _tag: "Review",
  reason: "no_relevant_open_topic",
  text: "Your cards are ready for your review.",
});
const ask = (
  topicKey: string,
  text = "Thank you.",
  question = "What matters here?"
) =>
  Schema.decodeUnknownSync(PrivateDiscoveryReply)({
    _tag: "Ask",
    question,
    text,
    topicKey,
  });
const unchanged: typeof PrivateDiscoveryContinuityUpdates.Type = [];

describe("private discovery continuity", () => {
  it("retains omitted circumstances while an unrelated topic is answered", () => {
    const routine = note("routine");
    const topic = note("preferences", "unresolved");
    const answered = {
      ...topic,
      detail: "The adult prefers roasted vegetables.",
      state: "answered" as const,
    };
    const result = applyPrivateDiscoveryContinuation(
      [routine, topic],
      [answered],
      review
    );
    expect(result.continuity).toEqual([routine, answered]);
    expect(result.message).toBe(review.text);
  });

  it("explicitly corrects a mistaken subject and detail without replacing other notes", () => {
    const first = {
      ...note("routine"),
      detail: "The adult cooks daily.",
      subject: "Daily cooking",
    };
    const other = note("equipment");
    const corrected = {
      ...first,
      detail: "The adult corrected this to weekend cooking.",
      subject: "Weekend cooking",
    };
    const result = applyPrivateDiscoveryContinuation(
      [first, other],
      [corrected],
      review
    );
    expect(result.continuity).toEqual([corrected, other]);
    expect(result.continuity).not.toContainEqual(first);
  });

  it.each(["answered", "no_information", "declined", "withdrawn"] as const)(
    "retains the explicit %s state and does not reopen its question",
    (state) => {
      const pending = note("topic", "unresolved");
      const closed = { ...pending, state };
      const result = applyPrivateDiscoveryContinuation(
        [pending],
        [closed],
        review
      );
      expect(result.continuity).toEqual([closed]);
      expect(() =>
        applyPrivateDiscoveryContinuation(
          result.continuity,
          unchanged,
          ask("topic")
        )
      ).toThrow(expect.objectContaining({ stage: "reply_decision" }));
    }
  );

  it("renders the exact model-authored question for a new or retained unresolved note", () => {
    const pending = note("topic", "unresolved");
    const reply = ask(
      "topic",
      "Please review the draft.",
      "Which part depends on your routine?"
    );
    for (const current of [[], [pending]]) {
      const result = applyPrivateDiscoveryContinuation(
        current,
        current.length === 0 ? [pending] : [],
        reply
      );
      expect(result.message).toBe(
        "Please review the draft.\n\nWhich part depends on your routine?"
      );
      expect(result.continuity).toEqual([pending]);
    }
  });

  it("mixes new and corrected notes while preserving retained and insertion order", () => {
    const retained = note("routine");
    const previous = note("equipment", "unresolved");
    const omitted = note("capacity");
    const corrected = {
      ...previous,
      detail: "The adult has a hob and corrected the earlier oven assumption.",
      state: "answered" as const,
      subject: "Available hob",
    };
    const firstNew = note("schedule");
    const nextQuestion = note("exceptions", "unresolved");
    const result = applyPrivateDiscoveryContinuation(
      [retained, previous, omitted],
      [firstNew, corrected, nextQuestion],
      ask(nextQuestion.key)
    );
    expect(result.continuity).toEqual([
      retained,
      corrected,
      omitted,
      firstNew,
      nextQuestion,
    ]);
  });

  it.each([
    {
      current: [],
      title: "duplicate new keys",
      updates: [note("a"), note("a")],
    },
    {
      current: [note("a")],
      title: "duplicate retained keys",
      updates: [note("a"), { ...note("a"), detail: "Different update." }],
    },
    {
      current: [note("a"), note("b"), note("c")],
      title: "seven updates",
      updates: [
        note("d"),
        note("e"),
        note("f"),
        note("g"),
        note("a"),
        note("b"),
        note("c"),
      ],
    },
  ])("rejects $title without mutating input", ({ current, updates }) => {
    const before = JSON.stringify(current);
    expect(() =>
      applyPrivateDiscoveryContinuation(current, updates, review)
    ).toThrow(expect.objectContaining({ stage: "continuity_updates" }));
    expect(JSON.stringify(current)).toBe(before);
  });

  it("rejects Review with an unresolved note and Ask with an unknown or non-topic key", () => {
    expect(() =>
      applyPrivateDiscoveryContinuation(
        [note("open", "unresolved")],
        unchanged,
        review
      )
    ).toThrow(expect.objectContaining({ stage: "reply_decision" }));
    expect(() =>
      applyPrivateDiscoveryContinuation([], unchanged, ask("missing"))
    ).toThrow(expect.objectContaining({ stage: "reply_decision" }));
    expect(() =>
      applyPrivateDiscoveryContinuation(
        [note("context")],
        unchanged,
        ask("context")
      )
    ).toThrow(expect.objectContaining({ stage: "reply_decision" }));
  });

  it("leaves unresolved context intact when the adult asks to stop", () => {
    const pending = note("topic", "unresolved");
    const stop = Schema.decodeUnknownSync(PrivateDiscoveryReply)({
      _tag: "Stop",
      reason: "participant_requested_stop",
      text: "We can stop here.",
    });
    expect(
      applyPrivateDiscoveryContinuation([pending], unchanged, stop)
    ).toEqual({ continuity: [pending], message: stop.text });
  });

  it("enforces the combined rendered length including its separator", () => {
    const pending = note("topic", "unresolved");
    const atLimit = applyPrivateDiscoveryContinuation(
      [pending],
      unchanged,
      ask("topic", "a".repeat(1000), "q".repeat(998))
    );
    expect(atLimit.message).toHaveLength(2000);
    expect(() =>
      applyPrivateDiscoveryContinuation(
        [pending],
        unchanged,
        ask("topic", "a".repeat(1000), "q".repeat(999))
      )
    ).toThrow(expect.objectContaining({ stage: "reply_limit" }));
  });

  it("retains twelve notes and rejects a thirteenth instead of evicting context", () => {
    const current = Array.from({ length: 12 }, (_, i) => note(`note-${i}`));
    expect(
      applyPrivateDiscoveryContinuation(current, unchanged, review).continuity
    ).toEqual(current);
    expect(() =>
      applyPrivateDiscoveryContinuation(current, [note("extra")], review)
    ).toThrow(expect.objectContaining({ stage: "continuity_limit" }));
    expect(current).toHaveLength(12);
  });

  it("checks serialized UTF-8 bytes even when every individual field fits", () => {
    const current = Array.from({ length: 6 }, (_, i) => ({
      ...note(`note-${i}`),
      detail: "🍲".repeat(100),
      subject: "🍲".repeat(60),
    }));
    const updates = [
      {
        ...note("extra"),
        detail: "🍲".repeat(100),
        subject: "🍲".repeat(60),
      },
    ];
    expect(() =>
      applyPrivateDiscoveryContinuation(current, updates, review)
    ).toThrow(expect.objectContaining({ stage: "continuity_limit" }));
  });

  it("uses one strict JSON codec and rejects malformed, duplicate or old free-text state", () => {
    const current = [note("routine"), note("topic", "no_information")];
    const encoded = Schema.encodeSync(PrivateDiscoveryContinuityJson)(current);
    expect(
      Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(encoded)
    ).toEqual(current);
    for (const stored of [
      "Previous free-text summary",
      "null",
      JSON.stringify([note("a"), note("a")]),
      JSON.stringify([{ ...note("a"), householdId: "forbidden" }]),
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

  it("bounds stored notes and update lists at their parsing boundaries", () => {
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryContinuity)(
        Array.from({ length: 13 }, (_, i) => note(`n${i}`))
      )
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryContinuityUpdates)(
        Array.from({ length: 7 }, (_, i) => note(`n${i}`))
      )
    ).toThrow();
  });

  it.each([
    {
      invalid: { additions: [note("a")], revisions: [] },
      title: "the old additions/revisions shape",
    },
    {
      invalid: [{ detail: "Missing required fields." }],
      title: "an incomplete note",
    },
    {
      invalid: [{ ...note("a"), actor: "forbidden" }],
      title: "an unknown note field",
    },
  ])("rejects $title", ({ invalid }) => {
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryContinuityUpdates)(invalid)
    ).toThrow();
  });
});
