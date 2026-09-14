import { ProfileVersion } from "@meal-planner/household-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AssistantTurn,
  AssistantTurnId,
  DirectoryCommand,
  DirectoryFrame,
  MAX_MESSAGE_LENGTH,
  MAX_PAGE_SIZE,
  ParticipantMessageText,
  ProfileCardChange,
  SessionCommand,
  SessionFrame,
} from "./index.js";

const decodeSession = Schema.decodeUnknownSync(SessionCommand, {
  onExcessProperty: "error",
});
const decodeDirectory = Schema.decodeUnknownSync(DirectoryCommand, {
  onExcessProperty: "error",
});
const decodeFrame = Schema.decodeUnknownSync(SessionFrame, {
  onExcessProperty: "error",
});
const mutationId = "114b891d-c1f0-4ac4-bfaf-59f4c827ad82";
const runId = "run-1789425600000-native_run";
const state = { status: "open", version: 1 };
const turn = {
  failure: null,
  id: runId,
  sourceMessageId: mutationId,
  status: "running",
};
const change = {
  _tag: "AddConfirmedProfileFact",
  fact: { _tag: "NoKnownHardConstraints" },
} satisfies ProfileCardChange;
const complete = {
  expectedVersion: 0,
  mutationId,
  type: "CompleteSession",
} satisfies SessionCommand;
const readCards = {
  afterOrdinal: 0,
  limit: MAX_PAGE_SIZE,
  requestId: mutationId,
  type: "ReadCards",
} satisfies SessionCommand;
const cardMutation = {
  cardId: mutationId,
  cardRevision: 0,
  expectedVersion: 0,
  mutationId,
};
const retainedCommands = [
  complete,
  readCards,
  {
    ...cardMutation,
    change,
    expectedProfileVersion: Schema.decodeUnknownSync(ProfileVersion)(0),
    reviewedFact: null,
    type: "ReviseProfileCard",
  },
  { ...cardMutation, type: "RejectProfileCard" },
  { ...cardMutation, safetyConfirmation: null, type: "ConfirmProfileCard" },
] satisfies readonly SessionCommand[];

describe("closed private domain protocol", () => {
  it.each(retainedCommands)(
    "accepts $type with exactly its domain fields",
    (command) => {
      expect(decodeSession(command)).toEqual(command);
      for (const field of [
        "actor",
        "role",
        "lifecycle",
        "personId",
        "model",
        "provider",
        "generation",
        "method",
        "params",
      ]) {
        expect(() =>
          decodeSession({ ...command, [field]: "caller-controlled" })
        ).toThrow();
      }
      expect(() =>
        decodeSession({ ...command, type: "UnknownCommand" })
      ).toThrow();
    }
  );

  it.each([
    {
      expectedVersion: 0,
      mutationId,
      text: "A private preference",
      type: "AppendParticipantMessage",
    },
    { ...readCards, type: "ReadHistory" },
    { requestId: mutationId, type: "ReadAssistantTurn" },
    {
      expectedVersion: 1,
      mutationId,
      turnId: mutationId,
      type: "CancelAssistantTurn",
    },
    {
      expectedVersion: 1,
      mutationId,
      turnId: mutationId,
      type: "RetryAssistantTurn",
    },
  ])("rejects the retired $type command", (command) => {
    expect(() => decodeSession(command)).toThrow();
    expect(() => decodeDirectory(command)).toThrow();
  });

  it("keeps participant text bounded at the native chat input boundary", () => {
    const decode = Schema.decodeUnknownSync(ParticipantMessageText);
    expect(decode("x")).toBe("x");
    expect(decode("x".repeat(MAX_MESSAGE_LENGTH))).toHaveLength(
      MAX_MESSAGE_LENGTH
    );
    for (const text of ["", "x".repeat(MAX_MESSAGE_LENGTH + 1), null, 42]) {
      expect(() => decode(text)).toThrow();
    }
  });

  it("requires nonnegative integer versions and bounded card and directory pages", () => {
    for (const expectedVersion of [-1, 0.5]) {
      expect(() => decodeSession({ ...complete, expectedVersion })).toThrow();
    }
    for (const type of ["ReadCards", "ListSessions"]) {
      const decode = type === "ReadCards" ? decodeSession : decodeDirectory;
      const command = { ...readCards, type };
      expect(decode(command)).toEqual(command);
      for (const limit of [0, 0.5, MAX_PAGE_SIZE + 1]) {
        expect(() => decode({ ...command, limit })).toThrow();
      }
      for (const afterOrdinal of [-1, 0.5]) {
        expect(() => decode({ ...command, afterOrdinal })).toThrow();
      }
    }
  });

  it("requires an explicit closed user-selected discovery scope on session creation", () => {
    expect(() =>
      decodeDirectory({ mutationId, type: "StartSession" })
    ).toThrow();
    expect(() =>
      decodeDirectory({
        mutationId,
        scope: "ChooseForMe",
        type: "StartSession",
      })
    ).toThrow();
    for (const scope of ["InitialDiscovery", "ProfileEdit"]) {
      expect(
        decodeDirectory({ mutationId, scope, type: "StartSession" })
      ).toEqual({ mutationId, scope, type: "StartSession" });
    }
  });

  it("does not admit supplied session or participant identity on creation", () => {
    for (const field of ["sessionReference", "personId", "actor", "role"]) {
      expect(() =>
        decodeDirectory({
          mutationId,
          scope: "ProfileEdit",
          type: "StartSession",
          [field]: mutationId,
        })
      ).toThrow();
    }
  });

  it("admits only closed proposed changes without provisional or invented authority", () => {
    const decode = Schema.decodeUnknownSync(ProfileCardChange, {
      onExcessProperty: "error",
    });
    expect(decode(change)).toEqual(change);
    expect(() =>
      decode({ ...change, _tag: "AddProvisionalProfileFact" })
    ).toThrow();
    for (const field of ["basis", "personId", "source", "actorId"]) {
      expect(() => decode({ ...change, [field]: "self" })).toThrow();
    }
    expect(() =>
      decodeSession({
        ...cardMutation,
        safetyConfirmation: "yes",
        type: "ConfirmProfileCard",
      })
    ).toThrow();
  });

  it("never admits server output or model dispatch as a participant command", () => {
    for (const type of [
      "AssistantTurnUpdated",
      "RunAssistantTurn",
      "AppendAssistantMessage",
    ]) {
      expect(() =>
        decodeSession({ expectedVersion: 0, mutationId, state, turn, type })
      ).toThrow();
    }
  });

  it("rejects RPC envelopes on both domain command and response protocols", () => {
    const decodeDirectoryFrame = Schema.decodeUnknownSync(DirectoryFrame, {
      onExcessProperty: "error",
    });
    for (const frame of [
      { args: [], id: mutationId, method: "fetch", type: "rpc" },
      { id: mutationId, jsonrpc: "2.0", method: "CompleteSession", params: [] },
      { id: mutationId, result: null, type: "rpc" },
    ]) {
      for (const decode of [
        decodeSession,
        decodeDirectory,
        decodeFrame,
        decodeDirectoryFrame,
      ]) {
        expect(() => decode(frame)).toThrow();
      }
    }
  });
});

describe("native run identity and retained domain updates", () => {
  it("accepts bounded opaque run IDs while message and mutation IDs remain UUIDs", () => {
    const decodeId = Schema.decodeUnknownSync(AssistantTurnId);
    const decodeTurn = Schema.decodeUnknownSync(AssistantTurn, {
      onExcessProperty: "error",
    });
    for (const id of ["a", runId, "A_9-".repeat(32), mutationId]) {
      expect(decodeId(id)).toBe(id);
      expect(decodeTurn({ ...turn, id })).toEqual({ ...turn, id });
    }
    expect(() => decodeTurn({ ...turn, sourceMessageId: runId })).toThrow();
    expect(() => decodeSession({ ...complete, mutationId: runId })).toThrow();
    for (const id of [
      "",
      "a".repeat(129),
      "run id",
      "run/id",
      "run:id",
      "run\n",
      "é",
      1,
      null,
    ]) {
      expect(() => decodeId(id)).toThrow();
      expect(() => decodeTurn({ ...turn, id })).toThrow();
    }
  });

  it("accepts native run IDs in session readiness and unsolicited turn updates", () => {
    for (const frame of [
      { state, turn, type: "AssistantTurnUpdated" },
      {
        assistantTurn: turn,
        bindingKey: "synthetic-private-binding",
        generation: mutationId,
        pendingConfirmation: null,
        sessionReference: mutationId,
        state,
        type: "SessionReady",
      },
    ]) {
      expect(decodeFrame(frame)).toEqual(frame);
      expect(() => decodeFrame({ ...frame, requestId: mutationId })).toThrow();
    }
  });

  it.each([
    {
      requestId: mutationId,
      state,
      turn: { ...turn, id: mutationId },
      type: "AssistantTurnRead",
    },
    {
      mutationId,
      state,
      turn: { ...turn, id: mutationId },
      type: "AssistantTurnChanged",
    },
    {
      assistantTurn: { ...turn, id: mutationId },
      message: {
        createdAt: 1_789_425_600_000,
        id: mutationId,
        ordinal: 0,
        role: "participant",
        text: "A private preference",
      },
      mutationId,
      state,
      type: "MessageAppended",
    },
    {
      hasMore: false,
      messages: [],
      requestId: mutationId,
      state,
      type: "HistoryRead",
    },
  ])("rejects the retired $type response frame", (frame) => {
    expect(() => decodeFrame(frame)).toThrow();
  });
});
