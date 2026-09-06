import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DirectoryCommand,
  MAX_MESSAGE_LENGTH,
  MAX_PAGE_SIZE,
  SessionCommand,
} from "./index.js";

const decodeSession = Schema.decodeUnknownSync(SessionCommand, {
  onExcessProperty: "error",
});
const mutationId = "114b891d-c1f0-4ac4-bfaf-59f4c827ad82";
const append = {
  expectedVersion: 0,
  mutationId,
  text: "A private preference",
  type: "AppendParticipantMessage",
};

describe("closed private participant protocol", () => {
  it.each(["actor", "role", "lifecycle"])(
    "rejects caller-controlled %s",
    (field) => {
      expect(() =>
        decodeSession({ ...append, [field]: "assistant" })
      ).toThrow();
    }
  );
  it("rejects assistant command variants and unbounded text before persistence", () => {
    expect(() =>
      decodeSession({ ...append, type: "AppendAssistantMessage" })
    ).toThrow();
    expect(() =>
      decodeSession({ ...append, text: "x".repeat(MAX_MESSAGE_LENGTH + 1) })
    ).toThrow();
    expect(() => decodeSession({ ...append, text: "" })).toThrow();
    expect(
      decodeSession({ ...append, text: "x".repeat(MAX_MESSAGE_LENGTH) })
    ).toMatchObject({ text: "x".repeat(MAX_MESSAGE_LENGTH) });
  });
  it("requires bounded integer versions and history pages", () => {
    expect(() => decodeSession({ ...append, expectedVersion: -1 })).toThrow();
    expect(() => decodeSession({ ...append, expectedVersion: 0.5 })).toThrow();
    expect(() =>
      decodeSession({
        afterOrdinal: 0,
        limit: MAX_PAGE_SIZE + 1,
        requestId: mutationId,
        type: "ReadHistory",
      })
    ).toThrow();
  });
  it("does not admit supplied session or participant identity on creation", () => {
    const decode = Schema.decodeUnknownSync(DirectoryCommand, {
      onExcessProperty: "error",
    });
    expect(() =>
      decode({ mutationId, sessionReference: mutationId, type: "StartSession" })
    ).toThrow();
    expect(() =>
      decode({ mutationId, personId: "someone-else", type: "StartSession" })
    ).toThrow();
  });
});
