import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { PrivateDiscoveryReply } from "./private-discovery-continuity.js";
import {
  applyPrivateDiscoveryContinuation,
  emptyPrivateDiscoveryContinuity,
  emptyPrivateDiscoveryContinuityUpdates,
  PrivateDiscoveryContinuity,
  PrivateDiscoveryContinuityJson,
  PrivateDiscoveryContinuityNote,
  PrivateDiscoveryContinuityUpdates,
} from "./private-discovery-continuity.js";

const participant = {
  id: crypto.randomUUID(),
  role: "participant" as const,
  text: "Please stop asking questions.",
};
const note = (key: string) => ({
  detail: "Useful private meal context.",
  key,
  subject: `Topic ${key}`,
});
const state = (...notes: (typeof PrivateDiscoveryContinuityNote.Type)[]) => ({
  ...emptyPrivateDiscoveryContinuity(),
  notes,
});
const changes = (...notes: (typeof PrivateDiscoveryContinuityNote.Type)[]) => ({
  ...emptyPrivateDiscoveryContinuityUpdates(),
  notes,
});
const continueReply = { _tag: "Continue" as const };
const apply = (
  current: typeof PrivateDiscoveryContinuity.Type,
  updates = changes(),
  reply: typeof PrivateDiscoveryReply.Type = continueReply
) =>
  applyPrivateDiscoveryContinuation(current, updates, reply, participant, [], {
    profileFacts: [],
    scope: "ProfileEdit",
  });

describe("bounded private context without model-owned questions", () => {
  it("retains omitted context and updates a note in place through restart", () => {
    const first = apply(state(), changes(note("routine"), note("equipment")));
    const corrected = {
      ...note("routine"),
      detail: "A corrected private circumstance.",
    };
    const second = apply(first.continuity, changes(note("new"), corrected));
    expect(second.continuity).toEqual(
      state(corrected, note("equipment"), note("new"))
    );
    expect(second.decision).toEqual({ _tag: "Review" });
    const restored = Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(
      Schema.encodeSync(PrivateDiscoveryContinuityJson)(second.continuity)
    );
    expect(apply(restored).continuity).toEqual(second.continuity);
  });
  it.each([
    { ...note("usual_meals"), question: "What do you usually eat?" },
    { ...note("usual_meals"), state: "unresolved" },
    { ...note("usual_meals"), state: "answered" },
    { ...note("usual_meals"), detail: "   " },
  ])("rejects obsolete question/state and empty context fields", (invalid) => {
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryContinuityNote)(invalid)
    ).toThrow();
  });
  it("cannot use a context note to reopen declined required meal coverage", () => {
    const current = {
      ...state(),
      coverage: {
        foodRestrictions: {
          _tag: "NoInformation" as const,
          evidence: { messageId: participant.id, quote: participant.text },
          reopenedBy: null,
        },
        usualMeals: {
          _tag: "Declined" as const,
          evidence: { messageId: participant.id, quote: participant.text },
        },
      },
    };
    const result = applyPrivateDiscoveryContinuation(
      current,
      changes(note("usual_meals_again")),
      { _tag: "Continue" },
      participant,
      [],
      { profileFacts: [], scope: "InitialDiscovery" }
    );
    expect(result.decision).toEqual({ _tag: "Review" });
    expect(result.continuity.coverage.usualMeals._tag).toBe("Declined");
  });
  it("rejects duplicate updates, excessive updates and snapshot overflow without eviction", () => {
    expect(() => apply(state(), changes(note("a"), note("a")))).toThrow(
      expect.objectContaining({ stage: "continuity_updates" })
    );
    expect(() =>
      apply(
        state(),
        changes(...Array.from({ length: 7 }, (_, i) => note(`n${i}`)))
      )
    ).toThrow(expect.objectContaining({ stage: "continuity_updates" }));
    const full = state(...Array.from({ length: 12 }, (_, i) => note(`n${i}`)));
    expect(apply(full).continuity).toEqual(full);
    expect(() => apply(full, changes(note("thirteenth")))).toThrow(
      expect.objectContaining({ stage: "continuity_limit" })
    );
    const large = Array.from({ length: 12 }, (_, i) => ({
      detail: "🍲".repeat(100),
      key: `n${i}`,
      subject: "🍲".repeat(59),
    }));
    expect(() =>
      Schema.decodeUnknownSync(PrivateDiscoveryContinuity)(state(...large))
    ).toThrow();
  });
  it("preserves Stop exactly and rejects simultaneous changes or stale stop evidence", () => {
    const current = state(note("context"));
    const reply = {
      _tag: "Stop" as const,
      evidence: { messageId: participant.id, quote: participant.text },
    };
    expect(apply(current, changes(), reply)).toEqual({
      continuity: current,
      decision: { _tag: "Stop" },
      message: "We can stop here.",
    });
    expect(() => apply(current, changes(note("new")), reply)).toThrow(
      expect.objectContaining({ stage: "reply_decision" })
    );
    expect(() =>
      apply(current, changes(), {
        ...reply,
        evidence: { ...reply.evidence, messageId: crypto.randomUUID() },
      })
    ).toThrow();
  });
  it("requires both coverage entries and the explicit nullable clarification update", () => {
    for (const invalid of [
      { mealFallbackNeeds: { declarations: [], updates: [] }, notes: [] },
      { ...changes(), clarification: undefined },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(PrivateDiscoveryContinuityUpdates)(invalid)
      ).toThrow();
    }
  });
});
