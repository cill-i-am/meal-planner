import { PersonProfile } from "@meal-planner/household-api";
import { Schema } from "effect";
import { Response as LocalResponse } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  emptyPrivateDiscoveryContinuity,
  emptyPrivateDiscoveryContinuityUpdates,
  PrivateDiscoveryContinuityJson,
} from "./private-discovery-continuity.js";
import type { PrivateDiscoveryContinuityNote } from "./private-discovery-continuity.js";
import {
  encodeKimiCompletion,
  kimiChunk,
  kimiChoice,
  kimiEvent,
} from "./private-discovery-kimi-stream.test-fixtures.js";
import { PrivateDiscoveryContext } from "./private-discovery-model.js";
import {
  makePrivateOutputHarness,
  nativePrivateChatInput,
} from "./private-output-native.test-fixture.js";
import type { PrivateSessionBinding } from "./private-output.contract.js";

const harness = makePrivateOutputHarness();
type Connection = Awaited<ReturnType<typeof harness.open>>;
const runNativeTurn = async (
  connection: Connection,
  options: Parameters<typeof harness.startTurn>[1] = {}
) => {
  const attempt = await harness.startTurn(connection, options);
  await attempt.finished;
};
const syntheticModelConfig = JSON.stringify({
  gatewayId: "synthetic-local-only",
  inputUsdPerMillionTokens: 1,
  maxOutputTokens: 1000,
  model: "@cf/moonshotai/kimi-k2.6",
  outputUsdPerMillionTokens: 2,
  timeoutMs: 5000,
});
beforeAll(async () => {
  await harness.start();
  await harness.setConfiguration(syntheticModelConfig);
}, 60_000);
afterAll(async () => {
  await harness.stop();
});
const latestAttempt = async (connection: Connection) => {
  const turns = await harness.turns(connection.binding);
  return turns.at(-1);
};
const expectStatus = async (
  pending: Promise<{
    readonly status: number;
  }>,
  status: number
) => {
  const response = await pending;
  expect(response.status).toBe(status);
};
const finishMessage = "You can finish this conversation when you're ready.";
const proposalReviewInvitation =
  "Review the profile proposals in the interface. They remain unconfirmed.";
const newTomatoProposalMessage = [
  "New profile proposal: add your preference for the ingredient “tomatoes”.",
  proposalReviewInvitation,
  finishMessage,
].join("\n\n");
const output = {
  _tag: "Continue",
  proposals: [] as unknown[],
  updates: emptyPrivateDiscoveryContinuityUpdates(),
};
const noteUpdates = (
  notes: readonly (typeof PrivateDiscoveryContinuityNote.Type)[]
) => ({
  ...emptyPrivateDiscoveryContinuityUpdates(),
  notes,
});
const noteSnapshot = (
  notes: readonly (typeof PrivateDiscoveryContinuityNote.Type)[]
) => ({
  ...emptyPrivateDiscoveryContinuity(),
  notes,
});
const supersededFollowUpReply = (topicKey: string, question: string) => ({
  _tag: "Continue",
  followUp: { question, topicKey },
});
type SyntheticOutput = Record<string, unknown>;
interface SyntheticUsage {
  readonly [key: string]: unknown;
  completion_tokens: number;
  prompt_tokens: number;
}
const defaultUsage = { completion_tokens: 20, prompt_tokens: 100 };
const response = (
  result: SyntheticOutput = output,
  usage: SyntheticUsage | null = defaultUsage
) => {
  const completion = {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          role: "assistant",
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({ intent: result }),
                name: "submitDiscoveryTurn",
              },
              id: "test-call",
              type: "function",
            },
          ],
        },
      },
    ],
  };
  return new LocalResponse(
    encodeKimiCompletion(
      usage === null ? completion : { ...completion, usage }
    ),
    { headers: { "content-type": "text/event-stream" } }
  );
};
const emptyProfile = (session: PrivateSessionBinding) => ({
  audit: null,
  facts: [],
  personId: session.personId,
  version: 0,
});
describe("native adaptive assistant attempts through the production model adapter", () => {
  const cards = (connection: Connection) =>
    harness.exchange(connection, {
      afterOrdinal: 0,
      limit: 25,
      requestId: crypto.randomUUID(),
      type: "ReadCards",
    });
  const audit = harness.turns;
  const diagnosticsSince = (start: number) =>
    harness.logs
      .slice(start)
      .filter((entry) =>
        entry.message.includes("private_discovery.invalid_output")
      );
  const expectDiagnostic = async (
    start: number,
    stage: string,
    privateValues: readonly string[] = []
  ) => {
    await expect.poll(() => diagnosticsSince(start)).toHaveLength(1);
    const logs = diagnosticsSince(start);
    expect(logs[0]?.level).toBe("log");
    expect(logs[0]?.message).toMatch(
      new RegExp(
        `^\\[\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\] WARN \\(#\\d+\\): private_discovery\\.invalid_output \\{ stage: '${stage}' \\}$`,
        "u"
      )
    );
    for (const value of privateValues) {
      expect(JSON.stringify(logs)).not.toContain(value);
    }
  };
  it.each([
    { kind: "response_envelope", stage: "response_envelope" },
    { kind: "reported_error", stage: "response_body_read" },
    { kind: "output_json", stage: "tool_call" },
    { kind: "output_schema", stage: "tool_call" },
  ] as const)(
    "rejects $kind with one safe $stage diagnostic outside native hydration",
    async ({ kind, stage }) => {
      harness.clearCalls();
      const privateValue = `synthetic-private-${crypto.randomUUID()}`;
      harness.setModelResponse(() => {
        if (kind === "response_envelope") {
          return new LocalResponse(JSON.stringify({ choices: privateValue }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (kind === "reported_error") {
          return new LocalResponse(
            `data: ${JSON.stringify({ error: { code: "synthetic_error", message: privateValue, type: "server_error" } })}\n\n`,
            { headers: { "content-type": "text/event-stream" } }
          );
        }
        return new LocalResponse(
          encodeKimiCompletion({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  role: "assistant",
                  tool_calls: [
                    {
                      function: {
                        arguments:
                          kind === "output_json"
                            ? `{${privateValue}`
                            : JSON.stringify({
                                intent: { ...output, actorId: privateValue },
                              }),
                        name: "submitDiscoveryTurn",
                      },
                      id: "synthetic-call",
                      type: "function",
                    },
                  ],
                },
              },
            ],
            usage: defaultUsage,
          }),
          { headers: { "content-type": "text/event-stream" } }
        );
      });
      const session = await harness.binding();
      const connection = await harness.open(session);
      const start = harness.logs.length;
      const attempt = await harness.startTurn(connection);
      const stream = await attempt.finished;
      await expectDiagnostic(start, stage, [
        privateValue,
        session.personId,
        session.sessionReference,
        attempt.turnId,
      ]);
      expect(await latestAttempt(connection)).toMatchObject({
        failure: "invalid_output",
        status: "failed",
      });
      expect(await harness.hydrate(connection)).toMatchObject({
        activeRun: null,
        messages: [{ role: "user" }],
      });
      expect(await cards(connection)).toMatchObject({ cards: [] });
      expect(stream).not.toContain(privateValue);
      const duplicate = await harness.chatRequest(connection, {
        body: attempt.input,
        method: "POST",
      });
      expect(duplicate.status).toBe(200);
      await duplicate.text();
      expect(harness.calls).toHaveLength(1);
      expect(diagnosticsSince(start)).toHaveLength(1);
      connection.socket.close();
    }
  );
  it("claims duplicate native POST requests once and atomically stores private output, summary and reviewed proposal", async () => {
    harness.clearCalls();
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const session = await harness.binding();
    const connection = await harness.open(session);
    const attempt = await harness.startTurn(connection);
    const first = attempt.finished;
    await expect.poll(() => harness.calls.length).toBe(1);
    const duplicate = await harness.chatRequest(connection, {
      body: attempt.input,
      method: "POST",
    });
    expect(duplicate.status).toBe(200);
    const second = duplicate.text();
    expect(await harness.metadata(connection.binding)).toMatchObject({
      version: 1,
    });
    expect(await latestAttempt(connection)).toMatchObject({
      id: attempt.turnId,
      status: "running",
    });
    expect(
      await harness.exchange(connection, {
        expectedVersion: 1,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      })
    ).toMatchObject({ reason: "assistant_turn_pending" });
    release.resolve(
      response({
        ...output,
        proposals: [
          {
            _tag: "ProposeProfileCard",
            change: {
              _tag: "AddFact",
              fact: {
                _tag: "FoodPreference",
                label: "tomatoes",
                sentiment: "like",
                targetKind: "ingredient",
              },
            },
          },
        ],
      })
    );
    await Promise.all([first, second]);
    expect(harness.calls).toHaveLength(1);
    expect(await harness.metadata(connection.binding)).toMatchObject({
      version: 2,
    });
    expect(await latestAttempt(connection)).toMatchObject({
      failure: null,
      id: attempt.turnId,
      status: "succeeded",
    });
    expect(await harness.hydrate(connection)).toMatchObject({
      messages: [
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({
          parts: [
            {
              content: newTomatoProposalMessage,
              type: "text",
            },
          ],
          role: "assistant",
        }),
      ],
    });
    expect(await cards(connection)).toMatchObject({
      cards: [
        expect.objectContaining({
          expectedProfileVersion: 0,
          id: expect.any(String),
          ordinal: 1,
          reviewedFact: null,
          revision: 0,
          status: "proposed",
        }),
      ],
    });
    const retained = await audit(session);
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({
      status: "succeeded",
      summary: JSON.stringify(emptyPrivateDiscoveryContinuity()),
    });
    expect(JSON.parse(retained[0]?.usageJson ?? "null")).toMatchObject({
      inputTokens: null,
      outputTokens: null,
    });
    expect(JSON.parse(retained[0]?.provenanceJson ?? "null")).toMatchObject({
      provider: "cloudflare-workers-ai",
    });
    expect(
      JSON.stringify(
        await harness.successful({
          action: "metadata",
          sessionReference: session.sessionReference,
        })
      )
    ).not.toContain(newTomatoProposalMessage);
    const request = harness.calls[0] as {
      body: {
        messages: readonly {
          content: string;
        }[];
      };
      gateway: unknown;
      extraHeaders: unknown;
    };
    expect(request.extraHeaders).toEqual({ "cf-aig-max-attempts": "1" });
    expect(request.gateway).toEqual({
      collectLog: false,
      id: "synthetic-local-only",
      requestTimeoutMs: 5000,
      skipCache: true,
    });
    const context = JSON.parse(request.body.messages[1]?.content ?? "null") as {
      profile: unknown;
      messages: readonly unknown[];
    };
    expect(context.profile).toEqual({ facts: [], version: 0 });
    expect(context.messages).toHaveLength(1);
    connection.socket.close();
  });
  const capturedContext = (index: number) => {
    const request = Schema.decodeUnknownSync(
      Schema.Struct({
        body: Schema.Struct({
          messages: Schema.Array(Schema.Struct({ content: Schema.String })),
        }),
      })
    )(harness.calls[index]);
    return Schema.decodeUnknownSync(
      Schema.fromJsonString(PrivateDiscoveryContext)
    )(request.body.messages[1]?.content);
  };
  const currentParticipant = () => {
    const participant = capturedContext(harness.calls.length - 1).messages.at(
      -1
    );
    if (participant === undefined || participant.role !== "participant") {
      throw new Error("Expected the current participant message");
    }
    return participant;
  };
  const routineNote = {
    detail: "The adult has little time to cook in the evening.",
    key: "cooking_window",
    subject: "Short evening cooking window",
  };
  const equipmentTopic = {
    detail: "Cooking equipment is not yet known.",
    key: "equipment",
    subject: "Available cooking equipment",
  };
  it("retains explicit initial-discovery scope across a failed first response and native restart", async () => {
    harness.clearCalls();
    harness.setModelResponse(() =>
      Promise.resolve(
        response({
          _tag: "Continue",
          proposals: [],
          updates: {
            mealFallbackNeeds: { declarations: [], updates: [] },
            notes: [],
          },
        })
      )
    );
    const session = await harness.binding();
    const first = await harness.open(session, {
      expiresAt: Date.now() + 60_000,
      scope: "InitialDiscovery",
    });
    await runNativeTurn(first);
    expect(await latestAttempt(first)).toMatchObject({
      failure: "invalid_output",
      status: "failed",
    });
    expect(capturedContext(0).scope).toBe("InitialDiscovery");
    const attempts = await audit(session);
    expect(attempts[0]?.summary).toBeNull();
    first.socket.close();
    await harness.restart();
    const resumed = await harness.open(session, {
      expiresAt: Date.now() + 60_000,
      scope: "InitialDiscovery",
    });
    harness.setModelResponse(() => Promise.resolve(response()));
    await runNativeTurn(resumed, {
      expectedVersion: 1,
      text: "Please continue.",
    });
    expect(capturedContext(1).scope).toBe("InitialDiscovery");
    expect(await latestAttempt(resumed)).toMatchObject({ status: "succeeded" });
    expect(await harness.hydrate(resumed)).toMatchObject({
      messages: [
        { role: "user" },
        { role: "user" },
        {
          parts: [
            {
              content:
                "Do you have any food allergies, intolerances or dietary restrictions?",
              type: "text",
            },
          ],
          role: "assistant",
        },
      ],
    });
    await expectStatus(
      harness.command({
        action: "initialize",
        binding: session,
        discoveryScope: "ProfileEdit",
        sessionReference: session.sessionReference,
      }),
      409
    );
    resumed.socket.close();
  });
  it.each(["foodRestrictions", "usualMeals"] as const)(
    "atomically rejects omitted required %s alongside a valid proposal",
    async (omitted) => {
      harness.clearCalls();
      harness.setModelResponse(() =>
        Promise.resolve(
          response({
            ...output,
            proposals: [
              {
                _tag: "ProposeProfileCard",
                change: {
                  _tag: "AddFact",
                  fact: {
                    _tag: "FoodPreference",
                    label: "tomatoes",
                    sentiment: "like",
                    targetKind: "ingredient",
                  },
                },
              },
            ],
            updates: {
              ...emptyPrivateDiscoveryContinuityUpdates(),
              coverage:
                omitted === "foodRestrictions"
                  ? { usualMeals: null }
                  : { foodRestrictions: null },
            },
          })
        )
      );
      const session = await harness.binding();
      const connection = await harness.open(session, {
        expiresAt: Date.now() + 60_000,
        scope: "InitialDiscovery",
      });
      await runNativeTurn(connection);
      expect(await harness.metadata(connection.binding)).toMatchObject({
        version: 1,
      });
      expect(await latestAttempt(connection)).toMatchObject({
        failure: "invalid_output",
        status: "failed",
      });
      expect(await cards(connection)).toMatchObject({ cards: [] });
      expect(await harness.hydrate(connection)).toMatchObject({
        messages: [{ role: "user" }],
      });
      const attempts = await audit(session);
      expect(attempts[0]?.summary).toBeNull();
      connection.socket.close();
    }
  );
  it("keeps unscoped legacy history readable and rejects generation before any provider call", async () => {
    harness.clearCalls();
    harness.setModelResponse(() => Promise.resolve(response()));
    const session = await harness.binding();
    const connection = await harness.open(session, {
      expiresAt: Date.now() + 60_000,
      scope: null,
    });
    await runNativeTurn(connection, {
      expectedVersion: 0,
      text: "Retained private history.",
    });
    expect(harness.calls).toHaveLength(0);
    expect(await latestAttempt(connection)).toMatchObject({
      failure: "invalid_output",
      status: "failed",
    });
    expect(await harness.hydrate(connection)).toMatchObject({
      messages: [
        {
          parts: [
            {
              content: "Retained private history.",
              type: "text",
            },
          ],
          role: "user",
        },
      ],
    });
    connection.socket.close();
    await harness.restart();
    const resumed = await harness.open(session, {
      expiresAt: Date.now() + 60_000,
      scope: null,
    });
    expect(await harness.hydrate(resumed)).toMatchObject({
      messages: [
        {
          parts: [
            {
              content: "Retained private history.",
              type: "text",
            },
          ],
        },
      ],
    });
    await expectStatus(
      harness.command({
        action: "initialize",
        binding: session,
        discoveryScope: "InitialDiscovery",
        sessionReference: session.sessionReference,
      }),
      409
    );
    resumed.socket.close();
  });
  it("persists typed needs with cards, retains omitted fields across native restart, and derives review only after every field is addressed", async () => {
    harness.clearCalls();
    harness.setModelResponse(() => {
      const participant = currentParticipant();
      return Promise.resolve(
        response({
          ...output,
          _tag: "Continue",
          proposals: [
            {
              _tag: "ProposeProfileCard",
              change: {
                _tag: "AddFact",
                fact: {
                  _tag: "FoodPreference",
                  label: "carrots",
                  sentiment: "like",
                  targetKind: "ingredient",
                },
              },
            },
          ],
          updates: {
            clarification: null,
            coverage: { foodRestrictions: null, usualMeals: null },
            mealFallbackNeeds: {
              declarations: [
                {
                  evidence: {
                    messageId: participant.id,
                    quote: "Jordan needs an alternative meal.",
                  },
                  subject: "Jordan",
                },
              ],
              updates: [],
            },
            notes: [],
          },
        })
      );
    });
    const session = await harness.binding();
    const connection = await harness.open(session);
    await runNativeTurn(connection, {
      expectedVersion: 0,
      text: "Jordan needs an alternative meal. I like carrots.",
    });
    const first = await audit(session);
    expect(first[0]?.status).toBe("succeeded");
    const saved = Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(
      first[0]?.summary
    );
    const [need] = saved.mealFallbackNeeds;
    if (need === undefined) {
      throw new Error("Expected the declared private need");
    }
    expect(need).toMatchObject({
      acceptableOption: { _tag: "Unanswered" },
      extraPreparation: { _tag: "Unanswered" },
      id: `${capturedContext(0).messages[0]?.id}:0`,
      reason: { _tag: "Unanswered" },
    });
    expect(await harness.hydrate(connection)).toMatchObject({
      messages: [
        { role: "user" },
        {
          parts: [
            {
              content: [
                "New profile proposal: add your preference for the ingredient “carrots”.",
                proposalReviewInvitation,
                "Private conversation context for Jordan: an alternative meal is needed.",
                "For Jordan, why is an alternative meal needed?",
              ].join("\n\n"),
              type: "text",
            },
          ],
          role: "assistant",
        },
      ],
    });
    const savedCards = await cards(connection);
    expect(savedCards).toMatchObject({
      cards: [
        { change: { _tag: "AddConfirmedProfileFact" }, status: "proposed" },
      ],
    });
    if (savedCards.type !== "CardsRead") {
      throw new Error("Expected private cards");
    }
    connection.socket.close();
    await harness.restart();
    const resumed = await harness.open(session);
    harness.setModelResponse(() =>
      Promise.resolve(
        response({
          ...output,
          _tag: "Continue",
        })
      )
    );
    await runNativeTurn(resumed, {
      expectedVersion: 2,
      text: "I have no known hard food constraints.",
    });
    expect(await latestAttempt(resumed)).toMatchObject({
      failure: null,
      status: "succeeded",
    });
    expect(capturedContext(1).continuity).toEqual(saved);
    expect(await harness.hydrate(resumed)).toMatchObject({
      messages: [
        {},
        {},
        { role: "user" },
        {
          parts: [
            {
              content: "For Jordan, why is an alternative meal needed?",
              type: "text",
            },
          ],
          role: "assistant",
        },
      ],
    });
    const omitted = await audit(session);
    expect(omitted[1]?.status).toBe("succeeded");
    expect(
      Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(
        omitted[1]?.summary
      )
    ).toEqual(saved);
    expect(await cards(resumed)).toEqual(
      expect.objectContaining({ cards: savedCards.cards })
    );
    harness.setModelResponse(() => {
      const participant = currentParticipant();
      const evidence = { messageId: participant.id, quote: participant.text };
      const reference = { _tag: "Existing", id: need.id };
      return Promise.resolve(
        response({
          ...output,
          _tag: "Continue",
          updates: {
            clarification: null,
            coverage: { foodRestrictions: null, usualMeals: null },
            mealFallbackNeeds: {
              declarations: [],
              updates: [
                {
                  _tag: "RecordReason",
                  evidence,
                  need: reference,
                  revisit: null,
                  value: "The shared dish is too spicy.",
                },
                {
                  _tag: "RecordOption",
                  evidence,
                  need: reference,
                  revisit: null,
                  value: {
                    description: "a plain sandwich",
                    kind: "generic",
                    quantity: null,
                    substitutions: null,
                  },
                },
                {
                  _tag: "RecordPreparation",
                  evidence,
                  need: reference,
                  revisit: null,
                  value: "Assembly without additional cooking is manageable.",
                },
              ],
            },
            notes: [],
          },
        })
      );
    });
    await runNativeTurn(resumed, {
      expectedVersion: 4,
      text: "The shared dish is too spicy. A plain sandwich works, and assembly without extra cooking is manageable.",
    });
    expect(await harness.metadata(resumed.binding)).toMatchObject({
      status: "open",
      version: 6,
    });
    expect(await latestAttempt(resumed)).toMatchObject({ status: "succeeded" });
    const completed = await audit(session);
    const completeSnapshot = Schema.decodeUnknownSync(
      PrivateDiscoveryContinuityJson
    )(completed[2]?.summary);
    expect(completeSnapshot.mealFallbackNeeds[0]).toMatchObject({
      acceptableOption: { _tag: "Answered", value: { kind: "generic" } },
      extraPreparation: { _tag: "Answered" },
      id: need.id,
      reason: { _tag: "Answered" },
    });
    expect(await harness.hydrate(resumed)).toMatchObject({
      messages: [
        {},
        {},
        {},
        {},
        {},
        {
          parts: [
            {
              content: [
                "Private conversation context for Jordan: reason: The shared dish is too spicy.; generic option: a plain sandwich; manageable extra preparation: Assembly without additional cooking is manageable.",
                finishMessage,
              ].join("\n\n"),
              type: "text",
            },
          ],
          role: "assistant",
        },
      ],
    });
    resumed.socket.close();
    const freshSession = { ...session, sessionReference: crypto.randomUUID() };
    const fresh = await harness.open(freshSession);
    harness.setModelResponse(() => Promise.resolve(response()));
    await runNativeTurn(fresh);
    expect(capturedContext(3).continuity).toEqual(
      emptyPrivateDiscoveryContinuity()
    );
    expect(capturedContext(3).cards).toEqual([]);
    expect(capturedContext(3).profile).toEqual({ facts: [], version: 0 });
    fresh.socket.close();
  });
  it.each([
    { kind: "current", stage: null },
    { kind: "missing", stage: "need_updates" },
    { kind: "stale", stage: "need_evidence" },
  ] as const)(
    "settles or rejects NoInformation with $kind revisit evidence for a declined option",
    async ({ kind, stage }) => {
      harness.clearCalls();
      const initialText =
        "Jordan needs an alternative meal because the shared dish is too spicy. No extra cooking is manageable. I do not want to discuss acceptable alternatives.";
      harness.setModelResponse(() => {
        const participant = currentParticipant();
        const evidence = { messageId: participant.id, quote: participant.text };
        const need = { _tag: "Declared", index: 0 };
        return Promise.resolve(
          response({
            ...output,
            updates: {
              clarification: null,
              coverage: { foodRestrictions: null, usualMeals: null },
              mealFallbackNeeds: {
                declarations: [{ evidence, subject: "Jordan" }],
                updates: [
                  {
                    _tag: "RecordReason",
                    evidence,
                    need,
                    revisit: null,
                    value: "The shared dish is too spicy.",
                  },
                  {
                    _tag: "RecordPreparation",
                    evidence,
                    need,
                    revisit: null,
                    value: "No extra cooking is manageable.",
                  },
                  {
                    _tag: "SetFieldDisposition",
                    disposition: "declined",
                    evidence,
                    field: "acceptableOption",
                    need,
                    revisit: null,
                  },
                ],
              },
              notes: [],
            },
          })
        );
      });
      const session = await harness.binding();
      let connection = await harness.open(session);
      try {
        await runNativeTurn(connection, {
          expectedVersion: 0,
          text: initialText,
        });
        const [initial] = await audit(session);
        expect(initial?.status).toBe("succeeded");
        const savedSummary = initial?.summary;
        const saved = Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(
          savedSummary
        );
        const [need] = saved.mealFallbackNeeds;
        if (need === undefined || need.acceptableOption._tag !== "Declined") {
          throw new Error("Expected the retained declined option");
        }
        expect(need).toMatchObject({
          extraPreparation: { _tag: "Answered" },
          reason: { _tag: "Answered" },
        });
        const staleRevisit = need.acceptableOption.evidence;
        const revisitQuote = "I want to revisit acceptable alternatives";
        const noInformationQuote = "I have no more information.";
        const participantText = `${revisitQuote}, but ${noInformationQuote} I like tomatoes.`;
        harness.setModelResponse(() => {
          const participant = currentParticipant();
          const revisits = {
            current: { messageId: participant.id, quote: revisitQuote },
            missing: null,
            stale: staleRevisit,
          };
          return Promise.resolve(
            response({
              ...output,
              proposals: [
                {
                  _tag: "ProposeProfileCard",
                  change: {
                    _tag: "AddFact",
                    fact: {
                      _tag: "FoodPreference",
                      label: "tomatoes",
                      sentiment: "like",
                      targetKind: "ingredient",
                    },
                  },
                },
              ],
              updates: {
                clarification: null,
                coverage: { foodRestrictions: null, usualMeals: null },
                mealFallbackNeeds: {
                  declarations: [],
                  updates: [
                    {
                      _tag: "SetFieldDisposition",
                      disposition: "no_information",
                      evidence: {
                        messageId: participant.id,
                        quote: noInformationQuote,
                      },
                      field: "acceptableOption",
                      need: { _tag: "Existing", id: need.id },
                      revisit: revisits[kind],
                    },
                  ],
                },
                notes: [],
              },
            })
          );
        });
        const start = harness.logs.length;
        await runNativeTurn(connection, {
          expectedVersion: 2,
          text: participantText,
        });
        expect(harness.calls).toHaveLength(2);
        expect(capturedContext(1).continuity).toEqual(saved);
        const attempts = await audit(session);
        expect(attempts[0]?.summary).toBe(savedSummary);
        if (stage !== null) {
          await expectDiagnostic(start, stage, [
            initialText,
            participantText,
            need.id,
          ]);
          expect(await harness.metadata(connection.binding)).toMatchObject({
            status: "open",
            version: 3,
          });
          expect(await latestAttempt(connection)).toMatchObject({
            failure: "invalid_output",
            status: "failed",
          });
          expect(await harness.hydrate(connection)).toMatchObject({
            messages: [
              { role: "user" },
              { role: "assistant" },
              { role: "user" },
            ],
          });
          expect(await cards(connection)).toMatchObject({ cards: [] });
          expect(attempts[1]?.summary).toBeNull();
          return;
        }
        expect(diagnosticsSince(start)).toHaveLength(0);
        expect(await harness.metadata(connection.binding)).toMatchObject({
          status: "open",
          version: 4,
        });
        expect(await latestAttempt(connection)).toMatchObject({
          failure: null,
          status: "succeeded",
        });
        const participant = currentParticipant();
        const settled = {
          ...saved,
          mealFallbackNeeds: [
            {
              ...need,
              acceptableOption: {
                _tag: "NoInformation",
                evidence: {
                  messageId: participant.id,
                  quote: noInformationQuote,
                },
                reopenedBy: { messageId: participant.id, quote: revisitQuote },
              },
            },
          ],
        };
        expect(
          Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(
            attempts[1]?.summary
          )
        ).toEqual(settled);
        expect(await harness.hydrate(connection)).toMatchObject({
          messages: [
            { role: "user" },
            { role: "assistant" },
            { role: "user" },
            {
              parts: [
                {
                  content: [
                    "New profile proposal: add your preference for the ingredient “tomatoes”.",
                    proposalReviewInvitation,
                    "Private conversation context for Jordan: reason: The shared dish is too spicy.; acceptable option: no information supplied; manageable extra preparation: No extra cooking is manageable.",
                    finishMessage,
                  ].join("\n\n"),
                  type: "text",
                },
              ],
              role: "assistant",
            },
          ],
        });
        const savedCards = await cards(connection);
        expect(savedCards).toMatchObject({
          cards: [
            { change: { _tag: "AddConfirmedProfileFact" }, status: "proposed" },
          ],
        });
        if (savedCards.type !== "CardsRead") {
          throw new Error("Expected private cards");
        }
        connection.socket.close();
        await harness.restart();
        connection = await harness.open(session);
        harness.setModelResponse(() => Promise.resolve(response()));
        await runNativeTurn(connection, {
          expectedVersion: 4,
          text: "Keep the information already recorded.",
        });
        expect(await harness.metadata(connection.binding)).toMatchObject({
          status: "open",
          version: 6,
        });
        expect(await latestAttempt(connection)).toMatchObject({
          failure: null,
          status: "succeeded",
        });
        expect(capturedContext(2).continuity).toEqual(settled);
        const afterRestart = await audit(session);
        expect(afterRestart[2]?.summary).toBe(attempts[1]?.summary);
        expect(await cards(connection)).toMatchObject({
          cards: savedCards.cards,
        });
        expect(await harness.hydrate(connection)).toMatchObject({
          messages: [
            {},
            {},
            {},
            {},
            { role: "user" },
            {
              parts: [
                {
                  content: finishMessage,
                  type: "text",
                },
              ],
              role: "assistant",
            },
          ],
        });
      } finally {
        connection.socket.close();
      }
    }
  );
  it.each([
    { kind: "old_evidence", stage: "need_evidence" },
    { kind: "assistant_evidence", stage: "need_evidence" },
    { kind: "missing_excerpt", stage: "need_evidence" },
    { kind: "unknown_need", stage: "need_updates" },
    { kind: "duplicate_field", stage: "need_updates" },
    { kind: "unknown_field", stage: "tool_call" },
    { kind: "superseded_follow_up", stage: "tool_call" },
    { kind: "snapshot_overflow", stage: "continuity_limit" },
  ])(
    "atomically rejects typed $kind with a valid proposed card",
    async ({ kind, stage }) => {
      harness.clearCalls();
      harness.setModelResponse(() =>
        Promise.resolve(
          response({ ...output, updates: noteUpdates([routineNote]) })
        )
      );
      const session = await harness.binding();
      const connection = await harness.open(session);
      await runNativeTurn(connection);
      const [savedAudit] = await audit(session);
      const saved = savedAudit?.summary;
      harness.setModelResponse(() => {
        const participant = currentParticipant();
        const context = capturedContext(harness.calls.length - 1);
        const evidence = { messageId: participant.id, quote: participant.text };
        const declaration = { evidence, subject: "Jordan" };
        const record = {
          _tag: "RecordReason",
          evidence,
          need: { _tag: "Declared", index: 0 },
          revisit: null,
          value: "The shared meal is too spicy.",
        };
        let typed: unknown = { declarations: [declaration], updates: [] };
        let reply: Record<string, unknown> = { _tag: "Continue" };
        switch (kind) {
          case "old_evidence":
          case "assistant_evidence": {
            const earlier = context.messages.find(
              (message) =>
                message.role ===
                (kind === "old_evidence" ? "participant" : "assistant")
            );
            if (earlier === undefined) {
              throw new Error("Expected the earlier message");
            }
            typed = {
              declarations: [
                {
                  ...declaration,
                  evidence: { messageId: earlier.id, quote: earlier.text },
                },
              ],
              updates: [],
            };
            break;
          }
          case "missing_excerpt": {
            typed = {
              declarations: [
                {
                  ...declaration,
                  evidence: {
                    ...evidence,
                    quote: "An unsupported private excerpt.",
                  },
                },
              ],
              updates: [],
            };
            break;
          }
          case "unknown_need": {
            typed = {
              declarations: [],
              updates: [
                {
                  ...record,
                  need: { _tag: "Existing", id: `${crypto.randomUUID()}:0` },
                },
              ],
            };
            break;
          }
          case "duplicate_field": {
            typed = { declarations: [declaration], updates: [record, record] };
            break;
          }
          case "unknown_field": {
            typed = {
              declarations: [declaration],
              updates: [{ ...record, approved: true }],
            };
            break;
          }
          case "superseded_follow_up": {
            reply = supersededFollowUpReply("missing", "What else matters?");
            break;
          }
          case "snapshot_overflow": {
            typed = {
              declarations: Array.from({ length: 3 }, (_, index) => ({
                evidence,
                subject: `${index}${"🍲".repeat(59)}`,
              })),
              updates: Array.from({ length: 3 }, (_, index) => [
                {
                  ...record,
                  need: { _tag: "Declared", index },
                  value: "🍲".repeat(100),
                },
                {
                  ...record,
                  _tag: "RecordPreparation",
                  need: { _tag: "Declared", index },
                  value: "🍲".repeat(100),
                },
              ]).flat(),
            };
            break;
          }
          default: {
            throw new Error("Unexpected invalid typed fixture");
          }
        }
        return Promise.resolve(
          response({
            _tag: "Continue",
            proposals: [
              {
                _tag: "ProposeProfileCard",
                change: {
                  _tag: "AddFact",
                  fact: {
                    _tag: "FoodPreference",
                    label: "tomatoes",
                    sentiment: "like",
                    targetKind: "ingredient",
                  },
                },
              },
            ],
            updates: {
              clarification: null,
              coverage: { foodRestrictions: null, usualMeals: null },
              mealFallbackNeeds: typed,
              notes: [],
            },
            ...reply,
          })
        );
      });
      const start = harness.logs.length;
      await runNativeTurn(connection, {
        expectedVersion: 2,
        text:
          kind === "snapshot_overflow"
            ? "🍲".repeat(200)
            : "Jordan needs an alternative meal.",
      });
      await expectDiagnostic(start, stage, [routineNote.detail]);
      expect(await harness.metadata(connection.binding)).toMatchObject({
        status: "open",
        version: 3,
      });
      expect(await latestAttempt(connection)).toMatchObject({
        failure: "invalid_output",
        status: "failed",
      });
      expect(await harness.hydrate(connection)).toMatchObject({
        messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }],
      });
      expect(await cards(connection)).toMatchObject({ cards: [] });
      const attempts = await audit(session);
      expect(attempts[0]?.summary).toBe(saved);
      expect(attempts[1]?.summary).toBeNull();
      expect(harness.calls).toHaveLength(2);
      connection.socket.close();
    }
  );
  it("applies mixed continuity updates with a card atomically, retains omitted notes across restart, and isolates a fresh session", async () => {
    harness.clearCalls();
    harness.setModelResponse(() =>
      Promise.resolve(
        response({
          _tag: "Continue",
          proposals: [],
          updates: noteUpdates([routineNote, equipmentTopic]),
        })
      )
    );
    const session = await harness.binding();
    const connection = await harness.open(session);
    await runNativeTurn(connection, {
      expectedVersion: 0,
      text: "I have little time to cook in the evening.",
    });
    expect(capturedContext(0).continuity).toEqual(
      emptyPrivateDiscoveryContinuity()
    );
    expect(await harness.hydrate(connection)).toMatchObject({
      messages: [
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({
          parts: [
            {
              content: finishMessage,
              type: "text",
            },
          ],
          role: "assistant",
        }),
      ],
    });
    const answered = {
      detail: "The adult has a hob.",
      key: equipmentTopic.key,
      subject: "Available hob",
    };
    const newNote = {
      detail: "The adult cooks at weekends.",
      key: "weekend_cooking",
      subject: "Weekend cooking",
    };
    harness.setModelResponse(() =>
      Promise.resolve(
        response({
          ...output,
          proposals: [
            {
              _tag: "ProposeProfileCard",
              change: {
                _tag: "AddFact",
                fact: {
                  _tag: "FoodPreference",
                  label: "tomatoes",
                  sentiment: "like",
                  targetKind: "ingredient",
                },
              },
            },
          ],
          updates: noteUpdates([newNote, answered]),
        })
      )
    );
    await runNativeTurn(connection, {
      expectedVersion: 2,
      text: "I have a hob and cook at weekends. I like tomatoes.",
    });
    expect(capturedContext(1).continuity).toEqual(
      noteSnapshot([routineNote, equipmentTopic])
    );
    const retained = await audit(session);
    expect(JSON.parse(retained[1]?.summary ?? "null")).toEqual(
      noteSnapshot([routineNote, answered, newNote])
    );
    expect(retained[1]?.status).toBe("succeeded");
    expect(await harness.hydrate(connection)).toMatchObject({
      messages: [
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({ role: "assistant" }),
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({
          parts: [
            {
              content: newTomatoProposalMessage,
              type: "text",
            },
          ],
          role: "assistant",
        }),
      ],
    });
    const savedCards = await cards(connection);
    expect(savedCards).toMatchObject({
      cards: [
        expect.objectContaining({
          change: {
            _tag: "AddConfirmedProfileFact",
            fact: {
              _tag: "FoodPreference",
              label: "tomatoes",
              sentiment: "like",
              targetKind: "ingredient",
            },
          },
          revision: 0,
          status: "proposed",
        }),
      ],
    });
    expect(
      JSON.stringify(
        await harness.successful({
          action: "metadata",
          sessionReference: session.sessionReference,
        })
      )
    ).not.toContain(routineNote.detail);
    connection.socket.close();
    await harness.restart();
    const resumed = await harness.open(session);
    harness.setModelResponse(() =>
      Promise.resolve(
        response({
          _tag: "Stop",
          evidence: {
            messageId: capturedContext(harness.calls.length - 1).messages.at(-1)
              ?.id,
            quote: "Please stop asking questions.",
          },
        })
      )
    );
    await runNativeTurn(resumed, {
      expectedVersion: 4,
      text: "Please stop asking questions.",
    });
    expect(await latestAttempt(resumed)).toMatchObject({
      failure: null,
      status: "succeeded",
    });
    expect(capturedContext(2).continuity).toEqual(
      noteSnapshot([routineNote, answered, newNote])
    );
    const resumedCards = await cards(resumed);
    if (savedCards.type !== "CardsRead" || resumedCards.type !== "CardsRead") {
      throw new Error("Expected private cards");
    }
    expect(resumedCards.cards).toEqual(savedCards.cards);
    expect(await harness.metadata(resumed.binding)).toMatchObject({
      status: "open",
      version: 6,
    });
    expect(await latestAttempt(resumed)).toMatchObject({ status: "succeeded" });
    expect(await harness.hydrate(resumed)).toMatchObject({
      messages: [
        {},
        {},
        {},
        {},
        { role: "user" },
        {
          parts: [
            {
              content: "We can stop here.",
              type: "text",
            },
          ],
          role: "assistant",
        },
      ],
    });
    const afterStop = await audit(session);
    expect(JSON.parse(afterStop[2]?.summary ?? "null")).toEqual(
      noteSnapshot([routineNote, answered, newNote])
    );
    const nextSession = { ...session, sessionReference: crypto.randomUUID() };
    const fresh = await harness.open(nextSession);
    harness.setModelResponse(() => Promise.resolve(response()));
    await runNativeTurn(fresh);
    const nextContext = capturedContext(3);
    expect(nextContext.continuity).toEqual(emptyPrivateDiscoveryContinuity());
    expect(nextContext.cards).toEqual([]);
    expect(nextContext.messages).toHaveLength(1);
    expect(JSON.stringify(nextContext)).not.toContain(routineNote.detail);
    expect(
      await harness.exchange(resumed, {
        expectedVersion: 6,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      })
    ).toMatchObject({ state: { status: "completed", version: 7 } });
    fresh.socket.close();
    resumed.socket.close();
  });
  it.each(["no_information", "declined"] as const)(
    "persists explicit %s private context and rejects a superseded model-authored follow-up",
    async (state) => {
      harness.clearCalls();
      harness.setModelResponse(() =>
        Promise.resolve(
          response({
            ...output,
            _tag: "Continue",
            updates: noteUpdates([equipmentTopic]),
          })
        )
      );
      const session = await harness.binding();
      const connection = await harness.open(session);
      await runNativeTurn(connection);
      const closed = {
        detail:
          state === "no_information"
            ? "The adult has no further information about this."
            : "The adult declined to discuss this topic.",
        key: equipmentTopic.key,
        subject: equipmentTopic.subject,
      };
      harness.setModelResponse(() =>
        Promise.resolve(
          response({
            ...output,
            updates: noteUpdates([closed]),
          })
        )
      );
      await runNativeTurn(connection, {
        expectedVersion: 2,
      });
      const afterResolution = await audit(session);
      const saved = afterResolution[1]?.summary;
      expect(JSON.parse(saved ?? "null")).toEqual(noteSnapshot([closed]));
      harness.setModelResponse(() =>
        Promise.resolve(
          response({
            ...output,
            reply: supersededFollowUpReply(
              equipmentTopic.key,
              "What equipment is available?"
            ),
          })
        )
      );
      const start = harness.logs.length;
      await runNativeTurn(connection, {
        expectedVersion: 4,
      });
      await expectDiagnostic(start, "tool_call", [closed.detail]);
      expect(await latestAttempt(connection)).toMatchObject({
        failure: "invalid_output",
        status: "failed",
      });
      const attempts = await audit(session);
      expect(attempts[1]?.summary).toBe(saved);
      expect(attempts[2]?.summary).toBeNull();
      connection.socket.close();
    }
  );
  it.each([
    {
      _tag: "Continue",
      stage: "tool_call",
      title: "the superseded additions/revisions shape",
      updates: { additions: [routineNote], revisions: [] },
    },
    {
      _tag: "Continue",
      stage: "continuity_updates",
      title: "duplicate new keys",
      updates: noteUpdates([equipmentTopic, equipmentTopic]),
    },
    {
      _tag: "Continue",
      stage: "continuity_updates",
      title: "duplicate retained keys",
      updates: noteUpdates([
        routineNote,
        { ...routineNote, detail: "Another update." },
      ]),
    },
    {
      _tag: "Continue",
      stage: "tool_call",
      title: "seven updates",
      updates: noteUpdates([
        ...Array.from({ length: 6 }, (_, i) => ({
          ...routineNote,
          key: `new-${i}`,
        })),
        routineNote,
      ]),
    },
    {
      _tag: "Continue",
      stage: "tool_call",
      title: "the removed unresolved note state",
      updates: {
        ...output.updates,
        notes: [
          {
            detail: equipmentTopic.detail,
            key: equipmentTopic.key,
            state: "unresolved",
            subject: equipmentTopic.subject,
          },
        ],
      },
    },
    {
      reply: supersededFollowUpReply("missing", "What else?"),
      stage: "tool_call",
      title: "the superseded model-authored followUp field",
      updates: output.updates,
    },
    {
      reply: {
        _tag: "Continue",
        text: "Private reply.",
      },
      stage: "tool_call",
      title: "the superseded model-authored text field",
      updates: output.updates,
    },
    {
      _tag: "Continue",
      stage: "tool_call",
      title: "a question on a settled circumstance",
      updates: {
        ...output.updates,
        notes: [{ ...routineNote, question: "What else?" }],
      },
    },
    {
      _tag: "Continue",
      stage: "tool_call",
      title: "an arbitrary model-authored question",
      updates: {
        ...output.updates,
        notes: [{ ...equipmentTopic, question: "q".repeat(2000) }],
      },
    },
  ])(
    "atomically rejects $title before storing a reply, card or replacement snapshot",
    async ({ updates, reply, stage }) => {
      harness.clearCalls();
      harness.setModelResponse(() =>
        Promise.resolve(
          response({
            ...output,
            updates: noteUpdates([routineNote]),
          })
        )
      );
      const session = await harness.binding();
      const connection = await harness.open(session);
      await runNativeTurn(connection);
      const beforeInvalidUpdate = await audit(session);
      const saved = beforeInvalidUpdate[0]?.summary;
      harness.setModelResponse(() => {
        const intent: SyntheticOutput = {
          _tag: "Continue",
          proposals: [
            {
              _tag: "ProposeProfileCard",
              change: {
                _tag: "AddFact",
                fact: {
                  _tag: "FoodPreference",
                  label: "tomatoes",
                  sentiment: "like",
                  targetKind: "ingredient",
                },
              },
            },
          ],
          updates,
        };
        if (reply !== undefined) {
          intent["reply"] = reply;
        }
        return Promise.resolve(response(intent));
      });
      const start = harness.logs.length;
      await runNativeTurn(connection, {
        expectedVersion: 2,
      });
      await expectDiagnostic(start, stage, [routineNote.detail]);
      expect(await harness.metadata(connection.binding)).toMatchObject({
        status: "open",
        version: 3,
      });
      expect(await latestAttempt(connection)).toMatchObject({
        failure: "invalid_output",
        status: "failed",
      });
      const transcript = await harness.hydrate(connection);
      expect(transcript.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
      ]);
      expect(await cards(connection)).toMatchObject({ cards: [] });
      const attempts = await audit(session);
      expect(attempts[0]?.summary).toBe(saved);
      expect(attempts[1]?.summary).toBeNull();
      expect(harness.calls).toHaveLength(2);
      connection.socket.close();
    }
  );
  it("cancels a native run and requires an explicit new participant turn before dispatching again", async () => {
    harness.clearCalls();
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const session = await harness.binding();
    const connection = await harness.open(session);
    const attempt = await harness.startTurn(connection);
    await expect.poll(() => harness.calls.length).toBe(1);
    const cancelled = await harness.chatRequest(connection, {
      method: "DELETE",
      query: `?runId=${attempt.turnId}`,
    });
    expect(cancelled.status).toBe(204);
    expect(await latestAttempt(connection)).toMatchObject({
      status: "cancelled",
    });
    await expectStatus(
      harness.chatRequest(connection, {
        method: "DELETE",
        query: `?runId=${attempt.turnId}`,
      }),
      409
    );
    release.resolve(response());
    await attempt.finished;
    expect(await harness.hydrate(connection)).toMatchObject({
      activeRun: null,
      messages: [{ role: "user" }],
    });
    const duplicate = await harness.chatRequest(connection, {
      body: attempt.input,
      method: "POST",
    });
    expect(duplicate.status).toBe(200);
    await duplicate.text();
    expect(harness.calls).toHaveLength(1);
    harness.setModelResponse(() => response(output, null));
    const next = await harness.startTurn(connection, {
      expectedVersion: 1,
      text: "Please continue with a new turn.",
    });
    await next.finished;
    expect(harness.calls).toHaveLength(2);
    expect(await harness.metadata(session)).toMatchObject({ version: 3 });
    expect(await latestAttempt(connection)).toMatchObject({
      status: "succeeded",
    });
    const attempts = await audit(session);
    expect(attempts.map((item) => item.status)).toEqual([
      "cancelled",
      "succeeded",
    ]);
    expect(attempts[0]?.summary).toBeNull();
    expect(JSON.parse(attempts[0]?.usageJson ?? "null")).toEqual({
      estimatedCostUsd: null,
      inputTokens: null,
      outputTokens: null,
    });
    expect(JSON.parse(attempts[1]?.usageJson ?? "null")).toEqual({
      estimatedCostUsd: null,
      inputTokens: null,
      outputTokens: null,
    });
    connection.socket.close();
  });
  it.each(["account", "household"] as const)(
    "fences a late provider response during %s revocation",
    async (scope) => {
      harness.clearCalls();
      const release = Promise.withResolvers<LocalResponse>();
      harness.setModelResponse(() => release.promise);
      const session = await harness.binding();
      const connection = await harness.open(session);
      const attempt = await harness.startTurn(connection);
      const running = attempt.finished;
      await expect.poll(() => harness.calls.length).toBe(1);
      const key =
        scope === "account" ? session.accountKey : session.householdKey;
      const operation = await harness.successful<{
        operationId: string;
      }>({
        action: "mutation-begin",
        intentKey: "a".repeat(64),
        key,
        scope,
        sessionReference: session.sessionReference,
      });
      await harness.successful({
        action: "mutation-prepare",
        key,
        operationId: operation.operationId,
        scope,
        sessionReference: session.sessionReference,
      });
      release.resolve(response());
      await running;
      const retained = await audit(session);
      expect(retained[0]).toMatchObject({
        failure: "connection_lost",
        status: "interrupted",
      });
      expect(
        connection.frames
          .filter((frame) => frame.type === "AssistantTurnUpdated")
          .map((frame) => frame.turn.status)
      ).not.toContain("succeeded");
      expect(
        await harness.successful({
          action: "metadata",
          sessionReference: session.sessionReference,
        })
      ).toMatchObject({ version: 1 });
      await harness.successful({
        action: "mutation-complete",
        key,
        operationId: operation.operationId,
        scope,
        sessionReference: session.sessionReference,
      });
      const resumed = await harness.open(session);
      expect(await harness.hydrate(resumed)).toMatchObject({
        messages: [expect.objectContaining({ role: "user" })],
      });
      expect(await cards(resumed)).toMatchObject({ cards: [] });
      resumed.socket.close();
    }
  );
  it("rejects a stale generation POST before dispatch after replacement", async () => {
    harness.clearCalls();
    harness.setModelResponse(() => response());
    const session = await harness.binding();
    const old = await harness.open(session);
    const input = nativePrivateChatInput(old, "Old generation input.");
    const current = await harness.open(session);
    await expectStatus(
      harness.chatRequest(old, { body: input, method: "POST" }),
      403
    );
    expect(harness.calls).toHaveLength(0);
    expect(await audit(session)).toEqual([]);
    expect(await harness.hydrate(current)).toMatchObject({
      activeRun: null,
      messages: [],
    });
    current.socket.close();
  });
  it("interrupts admitted work across restart and never silently resumes model activity", async () => {
    harness.clearCalls();
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const session = await harness.binding();
    const connection = await harness.open(session);
    const attempt = await harness.startTurn(connection);
    const running = attempt.finished.catch(() => "runtime-stopped");
    await expect.poll(() => harness.calls.length).toBe(1);
    await harness.restart();
    release.resolve(response());
    await running;
    const resumed = await harness.open(session);
    const replay = await harness.chatRequest(resumed, {
      body: attempt.input,
      method: "POST",
    });
    expect(replay.status).toBe(200);
    await replay.text();
    expect(await harness.metadata(session)).toMatchObject({ version: 1 });
    expect(await latestAttempt(resumed)).toMatchObject({
      failure: "runtime_restarted",
      status: "interrupted",
    });
    expect(harness.calls).toHaveLength(1);
    expect(await harness.hydrate(resumed)).toMatchObject({
      activeRun: null,
      messages: [{ role: "user" }],
    });
    resumed.socket.close();
  });
  it.each([
    {
      result: {
        ...output,
        proposals: [
          {
            _tag: "ReviseProposedProfileCard",
            cardId: "00000000-0000-0000-0000-000000000000",
            change: {
              _tag: "AddFact",
              fact: { _tag: "NoKnownHardConstraints" },
            },
          },
        ],
      },
      stage: "tool_call",
      title: "a revision when no proposed card exists",
    },
    {
      result: {
        ...output,
        proposals: [
          {
            _tag: "ProposeProfileCard",
            change: {
              _tag: "RemoveFact",
              factId: `fact_${crypto.randomUUID()}`,
            },
          },
        ],
      },
      stage: "proposal_unknown_fact",
      title: "unknown fact references",
    },
    {
      result: { ...output, actorId: "untrusted-model-actor" },
      stage: "tool_call",
      title: "untrusted authority fields",
    },
    {
      result: {
        ...output,
        proposals: [
          {
            _tag: "ProposeProfileCard",
            change: {
              _tag: "AddFact",
              fact: { _tag: "NoKnownHardConstraints" },
            },
          },
          {
            _tag: "ProposeProfileCard",
            change: {
              _tag: "AddFact",
              fact: { _tag: "NoKnownHardConstraints" },
            },
          },
        ],
      },
      stage: "proposal_duplicate",
      title: "duplicate proposals",
    },
  ])(
    "rejects $title without persisting partial output",
    async ({ result, stage }) => {
      const start = harness.logs.length;
      harness.clearCalls();
      const privateValue = `synthetic-private-${crypto.randomUUID()}`;
      harness.setModelResponse(() => Promise.resolve(response(result)));
      const session = await harness.binding();
      const connection = await harness.open(session);
      await runNativeTurn(connection, {
        expectedVersion: 0,
        text: privateValue,
      });
      expect(await harness.metadata(connection.binding)).toMatchObject({
        version: 1,
      });
      expect(await latestAttempt(connection)).toMatchObject({
        failure: "invalid_output",
        status: "failed",
      });
      expect(await cards(connection)).toMatchObject({ cards: [] });
      expect(await harness.hydrate(connection)).toMatchObject({
        messages: [expect.objectContaining({ role: "user" })],
      });
      const retained = await audit(session);
      expect(JSON.parse(retained[0]?.usageJson ?? "null")).toMatchObject({
        inputTokens: null,
        outputTokens: null,
      });
      await expectDiagnostic(start, stage, [
        privateValue,
        session.personId,
        session.sessionReference,
      ]);
      connection.socket.close();
    }
  );
  it.each(["correct", "rejected", "duplicate"] as const)(
    "handles a model card revision with a %s target",
    async (target) => {
      harness.clearCalls();
      const initialChange = {
        _tag: "AddFact",
        fact: {
          _tag: "FoodPreference",
          label: "tomatoes",
          sentiment: "like",
          targetKind: "ingredient",
        },
      };
      harness.setModelResponse(() =>
        Promise.resolve(
          response({
            ...output,
            proposals: [{ _tag: "ProposeProfileCard", change: initialChange }],
          })
        )
      );
      const session = await harness.binding();
      const connection = await harness.open(session);
      await runNativeTurn(connection);
      const initial = await cards(connection);
      if (initial.type !== "CardsRead" || initial.cards[0] === undefined) {
        throw new Error("Expected generated private card");
      }
      const [card] = initial.cards;
      let version = 2;
      if (target === "rejected") {
        await harness.exchange(connection, {
          cardId: card.id,
          cardRevision: card.revision,
          expectedVersion: version,
          mutationId: crypto.randomUUID(),
          type: "RejectProfileCard",
        });
        version += 1;
      }
      const correctedChange = {
        ...initialChange,
        fact: { ...initialChange.fact, sentiment: "strong_dislike" },
      };
      harness.setModelResponse(() =>
        Promise.resolve(
          response({
            ...output,
            _tag: "Continue",
            proposals: Array.from(
              { length: target === "duplicate" ? 2 : 1 },
              () => ({
                _tag: "ReviseProposedProfileCard",
                cardId: card.id,
                change: correctedChange,
              })
            ),
          })
        )
      );
      const diagnosticStart = harness.logs.length;
      await runNativeTurn(connection, {
        expectedVersion: version,
      });
      if (target === "correct") {
        expect(diagnosticsSince(diagnosticStart)).toHaveLength(0);
        expect(await harness.hydrate(connection)).toMatchObject({
          messages: [
            { role: "user" },
            {
              parts: [
                {
                  content: newTomatoProposalMessage,
                  type: "text",
                },
              ],
              role: "assistant",
            },
            { role: "user" },
            {
              parts: [
                {
                  content: [
                    "Revised profile proposal: add your strong dislike for the ingredient “tomatoes”.",
                    proposalReviewInvitation,
                    finishMessage,
                  ].join("\n\n"),
                  type: "text",
                },
              ],
              role: "assistant",
            },
          ],
        });
      } else {
        await expectDiagnostic(
          diagnosticStart,
          target === "duplicate" ? "proposal_duplicate" : "tool_call",
          [card.id, session.personId]
        );
      }
      const retained = await cards(connection);
      if (retained.type !== "CardsRead") {
        throw new Error("Expected private cards");
      }
      expect(retained.cards).toHaveLength(1);
      expect(retained.cards[0]).toMatchObject({
        change: {
          ...(target === "correct" ? correctedChange : initialChange),
          _tag: "AddConfirmedProfileFact",
        },
        id: card.id,
        ordinal: card.ordinal,
        revision: target === "correct" ? card.revision + 1 : card.revision,
        status: target === "rejected" ? "rejected" : "proposed",
      });
      expect(await latestAttempt(connection)).toMatchObject({
        failure: target === "correct" ? null : "invalid_output",
        status: target === "correct" ? "succeeded" : "failed",
      });
      const request = harness.calls[1] as {
        body: {
          messages: readonly {
            content: string;
          }[];
        };
      };
      const context = JSON.parse(
        request.body.messages[1]?.content ?? "null"
      ) as {
        cards: readonly unknown[];
        continuity: typeof PrivateDiscoveryContext.Type.continuity;
      };
      expect(context.cards).toEqual([
        expect.objectContaining({ id: card.id, revision: card.revision }),
      ]);
      expect(context.continuity).toEqual(emptyPrivateDiscoveryContinuity());
      connection.socket.close();
    }
  );
  it("detaches delivery on WebSocket close and resumes the durable run after renewed authorization", async () => {
    harness.clearCalls();
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const session = await harness.binding();
    const connection = await harness.open(session);
    const attempt = await harness.startTurn(connection);
    await expect.poll(() => harness.calls.length).toBe(1);
    connection.socket.close();
    await attempt.finished;
    expect(await latestAttempt(connection)).toMatchObject({
      status: "running",
    });
    const resumed = await harness.open(session);
    expect(await harness.hydrate(resumed)).toMatchObject({
      activeRun: { runId: attempt.turnId },
      messages: [{ role: "user" }],
    });
    const replay = await harness.chatRequest(resumed, {
      method: "GET",
      query: `?runId=${attempt.turnId}`,
    });
    expect(replay.status).toBe(200);
    const finished = replay.text();
    release.resolve(response());
    await finished;
    expect(harness.calls).toHaveLength(1);
    expect(await latestAttempt(resumed)).toMatchObject({ status: "succeeded" });
    expect(await harness.hydrate(resumed)).toMatchObject({
      activeRun: null,
      messages: [
        { role: "user" },
        {
          parts: [{ content: finishMessage, type: "text" }],
          role: "assistant",
        },
      ],
    });
    expect(await harness.metadata(session)).toMatchObject({ version: 2 });
    resumed.socket.close();
  });
  it("keeps a huge own profile intact and fails before dispatch when context cannot fit", async () => {
    harness.clearCalls();
    harness.setModelResponse(() => Promise.resolve(response()));
    const session = await harness.binding();
    const connection = await harness.open(session);
    const facts = Array.from({ length: 200 }, (_, index) => ({
      createdAtEpochMs: 0,
      createdBy: "a".repeat(64),
      createdInVersion: 1,
      id: `fact_${crypto.randomUUID()}`,
      source: "manual_ui",
      standing: { _tag: "confirmed", basis: "self" },
      updatedAtEpochMs: 0,
      updatedBy: "a".repeat(64),
      updatedInVersion: 1,
      value: {
        _tag: "HardConstraint",
        category: "allergen",
        handling: "exclude",
        label: `synthetic allergen ${index} ${"x".repeat(90)}`,
      },
    }));
    await runNativeTurn(connection, {
      profile: Schema.decodeUnknownSync(PersonProfile)({
        ...emptyProfile(session),
        facts,
        version: 1,
      }),
    });
    expect(harness.calls).toHaveLength(0);
    expect(await latestAttempt(connection)).toMatchObject({
      failure: "context_limit",
      status: "failed",
    });
    connection.socket.close();
  });
  it.each([
    "safety-removal",
    "safety-replacement",
    "ordinary-strong-dislike",
    "redundant-confirmation",
  ] as const)("matches canonical profile policy for %s", async (scenario) => {
    harness.clearCalls();
    const session = await harness.binding();
    const connection = await harness.open(session);
    const value =
      scenario === "ordinary-strong-dislike"
        ? {
            _tag: "FoodPreference",
            label: "tomatoes",
            sentiment: "strong_dislike",
            targetKind: "ingredient",
          }
        : {
            _tag: "HardConstraint",
            category: "allergen",
            handling: "exclude",
            label: "peanuts",
          };
    const fact = {
      createdAtEpochMs: 0,
      createdBy: "a".repeat(64),
      createdInVersion: 1,
      id: `fact_${crypto.randomUUID()}`,
      source: "manual_ui",
      standing: { _tag: "confirmed", basis: "self" },
      updatedAtEpochMs: 0,
      updatedBy: "a".repeat(64),
      updatedInVersion: 1,
      value,
    };
    const changes = {
      "ordinary-strong-dislike": { _tag: "RemoveFact", factId: fact.id },
      "redundant-confirmation": { _tag: "ConfirmFact", factId: fact.id },
      "safety-removal": { _tag: "RemoveFact", factId: fact.id },
      "safety-replacement": {
        _tag: "ReplaceFact",
        fact: { _tag: "NoKnownHardConstraints" },
        factId: fact.id,
      },
    };
    const change = changes[scenario];
    harness.setModelResponse(() =>
      Promise.resolve(
        response({
          ...output,
          proposals: [{ _tag: "ProposeProfileCard", change }],
        })
      )
    );
    const diagnosticStart = harness.logs.length;
    await runNativeTurn(connection, {
      profile: Schema.decodeUnknownSync(PersonProfile)({
        ...emptyProfile(session),
        facts: [fact],
        version: 1,
      }),
    });
    const rejected = scenario === "redundant-confirmation";
    if (rejected) {
      await expectDiagnostic(
        diagnosticStart,
        scenario === "redundant-confirmation"
          ? "proposal_already_confirmed"
          : "proposal_fact_kind",
        [fact.id, session.personId]
      );
    } else {
      expect(diagnosticsSince(diagnosticStart)).toHaveLength(0);
    }
    expect(await latestAttempt(connection)).toMatchObject({
      failure: rejected ? "invalid_output" : null,
      status: rejected ? "failed" : "succeeded",
    });
    expect(await cards(connection)).toMatchObject({
      cards: rejected
        ? []
        : [
            expect.objectContaining({
              change:
                scenario === "ordinary-strong-dislike"
                  ? { _tag: "RemoveOrdinaryProfileFact", factId: fact.id }
                  : {
                      _tag: "ConfirmHardConstraintReduction",
                      factId: fact.id,
                      replacement:
                        scenario === "safety-replacement"
                          ? { _tag: "NoKnownHardConstraints" }
                          : null,
                    },
              expectedProfileVersion: 1,
              reviewedFact: value,
              status: "proposed",
            }),
          ],
    });
    connection.socket.close();
  });
  it.each(["refused", "provider_unavailable"] as const)(
    "retains a %s response without implicit provider retry",
    async (scenario) => {
      harness.clearCalls();
      harness.setModelResponse(() =>
        scenario === "provider_unavailable"
          ? new LocalResponse(null, { status: 503 })
          : new LocalResponse(
              encodeKimiCompletion({
                choices: [
                  {
                    finish_reason: "stop",
                    message: {
                      content: null,
                      refusal: "Synthetic refusal",
                      role: "assistant",
                    },
                  },
                ],
                usage: defaultUsage,
              }),
              { headers: { "content-type": "text/event-stream" } }
            )
      );
      const session = await harness.binding();
      const connection = await harness.open(session);
      const attempt = await harness.startTurn(connection);
      await attempt.finished;
      const duplicate = await harness.chatRequest(connection, {
        body: attempt.input,
        method: "POST",
      });
      expect(duplicate.status).toBe(200);
      await duplicate.text();
      expect(harness.calls).toHaveLength(1);
      expect(await latestAttempt(connection)).toMatchObject({
        failure: scenario === "refused" ? "invalid_output" : scenario,
        status: "failed",
      });
      const retained = await audit(session);
      expect(JSON.parse(retained[0]?.provenanceJson ?? "null")).toMatchObject({
        model: "@cf/moonshotai/kimi-k2.6",
        provider: "cloudflare-workers-ai",
      });
      expect(await harness.hydrate(connection)).toMatchObject({
        activeRun: null,
        messages: [{ role: "user" }],
      });
      connection.socket.close();
    }
  );
  it("rejects a foreign profile before participant admission or any model call", async () => {
    harness.clearCalls();
    harness.setModelResponse(() => response());
    const session = await harness.binding();
    const connection = await harness.open(session);
    const input = nativePrivateChatInput(
      connection,
      "Rightful participant input."
    );
    const profile = Schema.decodeUnknownSync(PersonProfile)({
      ...emptyProfile(session),
      personId: `person_${crypto.randomUUID()}`,
    });
    await expectStatus(
      harness.chatRequest(connection, {
        body: input,
        method: "POST",
        profile,
      }),
      403
    );
    expect(harness.calls).toHaveLength(0);
    expect(await audit(session)).toEqual([]);
    expect(await harness.hydrate(connection)).toMatchObject({
      activeRun: null,
      messages: [],
    });
    const admitted = await harness.chatRequest(connection, {
      body: input,
      method: "POST",
    });
    expect(admitted.status).toBe(200);
    await admitted.text();
    expect(harness.calls).toHaveLength(1);
    expect(await latestAttempt(connection)).toMatchObject({
      status: "succeeded",
    });
    connection.socket.close();
  });
  it("retains dispatch provenance when a running attempt loses its runtime", async () => {
    harness.clearCalls();
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const session = await harness.binding();
    const connection = await harness.open(session);
    const attempt = await harness.startTurn(connection);
    const running = attempt.finished.then(
      () => "finished",
      () => "runtime-stopped"
    );
    await expect.poll(() => harness.calls.length).toBe(1);
    const dispatched = await audit(session);
    expect(dispatched[0]?.status).toBe("running");
    expect(JSON.parse(dispatched[0]?.provenanceJson ?? "null")).toMatchObject({
      model: "@cf/moonshotai/kimi-k2.6",
    });
    await harness.restart();
    release.resolve(response());
    await running;
    const resumed = await harness.open(session);
    const retained = await audit(session);
    expect(retained[0]).toMatchObject({
      failure: "runtime_restarted",
      status: "interrupted",
      summary: null,
      usageJson: null,
    });
    expect(retained[0]?.provenanceJson).toBe(dispatched[0]?.provenanceJson);
    expect(harness.calls).toHaveLength(1);
    expect(await harness.hydrate(resumed)).toMatchObject({
      messages: [expect.objectContaining({ role: "user" })],
    });
    expect(await harness.metadata(resumed.binding)).toMatchObject({
      version: 1,
    });
    resumed.socket.close();
  });
  describe("Kimi streamed tool settlement", () => {
    it.each([
      "complete",
      "missing-done",
      "invalid-arguments",
      "missing-required-key",
      "reported-error",
    ] as const)(
      "keeps partial %s SSE private and only commits a complete validated tool call",
      async (outcome) => {
        harness.clearCalls();
        const proposed = {
          ...output,
          proposals: [
            {
              _tag: "ProposeProfileCard",
              change: {
                _tag: "AddFact",
                fact: {
                  _tag: "FoodPreference",
                  label: "tomatoes",
                  sentiment: "like",
                  targetKind: "ingredient",
                },
              },
            },
          ],
        };
        const argumentsText =
          outcome === "invalid-arguments"
            ? "{invalid-private-tool"
            : JSON.stringify({
                intent:
                  outcome === "missing-required-key"
                    ? {
                        ...proposed,
                        updates: {
                          ...proposed.updates,
                          coverage: { foodRestrictions: null },
                        },
                      }
                    : proposed,
              });
        const encoded = encodeKimiCompletion({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                role: "assistant",
                tool_calls: [
                  {
                    function: {
                      arguments: argumentsText,
                      name: "submitDiscoveryTurn",
                    },
                    id: "synthetic-call",
                    type: "function",
                  },
                ],
              },
            },
          ],
          usage: defaultUsage,
        });
        const opened =
          Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            opened.resolve(controller);
          },
        });
        const controller = await opened.promise;
        const firstEnd = encoded.indexOf("\n\n") + 2;
        const interimUsage = kimiEvent(
          kimiChunk(
            [
              kimiChoice({
                content: "",
                reasoning_content: null,
                role: "assistant",
              }),
            ],
            { completion_tokens: 0, prompt_tokens: 100 }
          )
        );
        controller.enqueue(
          new TextEncoder().encode(interimUsage + encoded.slice(0, firstEnd))
        );
        harness.setModelResponse(() =>
          Promise.resolve(
            new LocalResponse(body, {
              headers: { "content-type": "text/event-stream" },
            })
          )
        );
        const session = await harness.binding();
        const connection = await harness.open(session);
        const attempt = await harness.startTurn(connection);
        const running = attempt.finished;
        await expect.poll(() => harness.calls.length).toBe(1);
        expect(harness.calls[0]).toMatchObject({
          body: { stream: true, stream_options: { include_usage: true } },
          gateway: { requestTimeoutMs: 5000 },
        });
        expect(await latestAttempt(connection)).toMatchObject({
          status: "running",
        });
        expect(await cards(connection)).toMatchObject({ cards: [] });
        expect(await harness.hydrate(connection)).toMatchObject({
          messages: [expect.objectContaining({ role: "user" })],
        });
        expect(await harness.metadata(connection.binding)).toMatchObject({
          version: 1,
        });
        const beforeEnd = await audit(session);
        expect(beforeEnd[0]).toMatchObject({ summary: null, usageJson: null });
        let rest = encoded.slice(firstEnd);
        if (outcome === "missing-done") {
          rest = rest.replace("data: [DONE]\n\n", "");
        }
        if (outcome === "reported-error") {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ error: { code: "synthetic_error", message: "Synthetic reported stream failure", type: "server_error" } })}\n\n`
            )
          );
        } else {
          controller.enqueue(new TextEncoder().encode(rest));
        }
        controller.close();
        // Reported stream errors reject the prepared proposal before native completion.
        await running;
        const duplicate = await harness.chatRequest(connection, {
          body: attempt.input,
          method: "POST",
        });
        expect(duplicate.status).toBe(200);
        await duplicate.text();
        expect(harness.calls).toHaveLength(1);
        if (outcome === "complete" || outcome === "missing-done") {
          expect(await harness.metadata(connection.binding)).toMatchObject({
            version: 2,
          });
          expect(await latestAttempt(connection)).toMatchObject({
            failure: null,
            status: "succeeded",
          });
          expect(await cards(connection)).toMatchObject({
            cards: [
              expect.objectContaining({ revision: 0, status: "proposed" }),
            ],
          });
          expect(await harness.hydrate(connection)).toMatchObject({
            messages: [
              expect.objectContaining({ role: "user" }),
              expect.objectContaining({ role: "assistant" }),
            ],
          });
          const [retained] = await audit(session);
          expect(retained?.summary).toBe(
            JSON.stringify(emptyPrivateDiscoveryContinuity())
          );
          expect(JSON.parse(retained?.usageJson ?? "null")).toMatchObject({
            inputTokens: null,
            outputTokens: null,
          });
        } else {
          expect(await harness.metadata(connection.binding)).toMatchObject({
            version: 1,
          });
          expect(await latestAttempt(connection)).toMatchObject({
            failure: "invalid_output",
            status: "failed",
          });
          expect(await cards(connection)).toMatchObject({ cards: [] });
          expect(await harness.hydrate(connection)).toMatchObject({
            messages: [expect.objectContaining({ role: "user" })],
          });
          const rejected = await audit(session);
          expect(rejected[0]).toMatchObject({ summary: null });
        }
        connection.socket.close();
      }
    );
  });
});
