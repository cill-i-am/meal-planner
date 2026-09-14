import { Response as LocalResponse } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { emptyPrivateDiscoveryContinuityUpdates } from "./private-discovery-continuity.js";
import { encodeKimiCompletion } from "./private-discovery-kimi-stream.test-fixtures.js";
import {
  makePrivateOutputHarness,
  nativeMessageText,
  syntheticPrivateDiscoveryConfiguration,
} from "./private-output-native.test-fixture.js";
import type { PrivateNativeConnection } from "./private-output-native.test-fixture.js";
import type { PrivateSessionBinding } from "./private-output.contract.js";

const harness = makePrivateOutputHarness();
const proposalText =
  "New profile proposal: add your preference for the ingredient “tomatoes”.";
const completedResponse = () =>
  new LocalResponse(
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
                  arguments: JSON.stringify({
                    intent: {
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
                        ...emptyPrivateDiscoveryContinuityUpdates(),
                        notes: [
                          {
                            detail: "The adult cooks at weekends.",
                            key: "weekend_cooking",
                            subject: "Weekend cooking",
                          },
                        ],
                      },
                    },
                  }),
                  name: "submitDiscoveryTurn",
                },
                id: "synthetic-reconnect-call",
                type: "function",
              },
            ],
          },
        },
      ],
      usage: { completion_tokens: 20, prompt_tokens: 100 },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );

beforeAll(async () => {
  await harness.start();
  await harness.setConfiguration(syntheticPrivateDiscoveryConfiguration);
}, 60_000);
afterAll(async () => {
  await harness.stop();
});

const beginPending = (binding: PrivateSessionBinding) =>
  harness.successful<string>({
    action: "begin",
    binding,
    sessionReference: binding.sessionReference,
  });
const lifecycle = (binding: PrivateSessionBinding) =>
  harness.successful({
    action: "lifecycle",
    sessionReference: binding.sessionReference,
  });
const keepAliveReferences = (binding: PrivateSessionBinding) =>
  harness.successful<number>({
    action: "keep-alive-references",
    sessionReference: binding.sessionReference,
  });
const authorize = (binding: PrivateSessionBinding, generation: string) =>
  harness.command({
    action: "authorize",
    binding,
    expiresAt: Date.now() + 60_000,
    generation,
    sessionReference: binding.sessionReference,
  });
const cards = (connection: PrivateNativeConnection) =>
  harness.exchange(connection, {
    afterOrdinal: 0,
    limit: 25,
    requestId: crypto.randomUUID(),
    type: "ReadCards",
  });
const replay = (connection: PrivateNativeConnection, runId: string) =>
  harness.chatRequest(connection, { method: "GET", query: `?runId=${runId}` });
const expectRejected = async (
  pending: ReturnType<typeof harness.command>,
  status: number
) => {
  const response = await pending;
  expect(response.status).toBe(status);
};
const mutation = async (
  binding: PrivateSessionBinding,
  scope: "account" | "household"
) => {
  const key = scope === "account" ? binding.accountKey : binding.householdKey;
  const result = await harness.successful<{ operationId: string }>({
    action: "mutation-begin",
    intentKey: "a".repeat(64),
    key,
    scope,
    sessionReference: binding.sessionReference,
  });
  const operation = {
    key,
    operationId: result.operationId,
    scope,
    sessionReference: binding.sessionReference,
  };
  await harness.successful({ ...operation, action: "mutation-prepare" });
  return operation;
};

const expectAcceptedOnce = async (
  connection: PrivateNativeConnection,
  runId: string
) => {
  const history = await harness.hydrate(connection);
  expect(history.activeRun).toBeNull();
  expect(history.messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
  ]);
  const assistant = history.messages.at(-1);
  if (assistant === undefined) {
    throw new Error("Expected the accepted assistant reply");
  }
  expect(nativeMessageText(assistant)).toContain(proposalText);
  expect(await cards(connection)).toMatchObject({
    cards: [{ revision: 0, status: "proposed" }],
  });
  const attempts = await harness.turns(connection.binding);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    failure: null,
    id: runId,
    status: "succeeded",
  });
  expect(attempts[0]?.summary).toContain("weekend_cooking");
  expect(await harness.metadata(connection.binding)).toMatchObject({
    version: 2,
  });
  expect(harness.calls).toHaveLength(1);
  return history;
};

describe("native private chat reconnect authorization", () => {
  it("expires a complete tool waiting for pending authorization and never commits after reconnect", async () => {
    const timeoutMs = 1000;
    await harness.setConfiguration(
      JSON.stringify({
        gatewayId: "synthetic-local-only",
        inputUsdPerMillionTokens: 1,
        maxOutputTokens: 65_536,
        model: "@cf/moonshotai/kimi-k2.6",
        outputUsdPerMillionTokens: 2,
        timeoutMs,
      })
    );
    harness.clearCalls();
    const release = Promise.withResolvers<LocalResponse>();
    const consumed = Promise.withResolvers<null>();
    let renewed: PrivateNativeConnection | undefined;
    try {
      const encoded = new TextEncoder().encode(
        await completedResponse().text()
      );
      let sent = false;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (sent) {
              controller.close();
              consumed.resolve(null);
            } else {
              sent = true;
              controller.enqueue(encoded);
            }
          },
        },
        { highWaterMark: 0 }
      );
      harness.setModelResponse(() => release.promise);
      const binding = await harness.binding();
      const original = await harness.open(binding);
      const dispatchedAt = Date.now();
      const attempt = await harness.startTurn(original);
      await expect.poll(() => harness.calls.length).toBe(1);
      const pendingGeneration = await beginPending(binding);
      expect(await lifecycle(binding)).toMatchObject({
        generation: pendingGeneration,
        status: "pending",
      });
      const detached = await attempt.finished;
      expect(detached).not.toContain(proposalText);
      release.resolve(
        new LocalResponse(body, {
          headers: { "content-type": "text/event-stream" },
        })
      );
      await consumed.promise;
      // The full valid tool reaches the native transport while B is pending, before the actual deadline.
      expect(Date.now() - dispatchedAt).toBeLessThan(timeoutMs);
      const waiting = await harness.turns(binding);
      expect(waiting).toMatchObject([
        { id: attempt.turnId, status: "running", summary: null },
      ]);
      expect(await keepAliveReferences(binding)).toBe(1);
      await expect
        .poll(
          async () => {
            const [current] = await harness.turns(binding);
            return {
              failure: current?.failure,
              references: await keepAliveReferences(binding),
              status: current?.status,
            };
          },
          { timeout: timeoutMs + 2000 }
        )
        .toEqual({
          failure: "outcome_unknown",
          references: 0,
          status: "interrupted",
        });
      const expired = await harness.turns(binding);
      const expiredReferences = await keepAliveReferences(binding);
      expect(await lifecycle(binding)).toMatchObject({
        generation: pendingGeneration,
        status: "pending",
      });
      renewed = await harness.open(binding);
      const resumed = await replay(renewed, attempt.turnId);
      expect(resumed.status).toBe(200);
      const terminal = await resumed.text();
      expect(expired).toMatchObject([
        {
          failure: "outcome_unknown",
          id: attempt.turnId,
          status: "interrupted",
          summary: null,
        },
      ]);
      expect(expiredReferences).toBe(0);
      expect(terminal).not.toContain("RUN_FINISHED");
      expect(terminal).not.toContain(proposalText);
      expect(await harness.hydrate(renewed)).toMatchObject({
        activeRun: null,
        messages: [{ role: "user" }],
      });
      expect(await cards(renewed)).toMatchObject({ cards: [] });
      expect(await harness.turns(binding)).toMatchObject([
        {
          failure: "outcome_unknown",
          id: attempt.turnId,
          status: "interrupted",
          summary: null,
        },
      ]);
      expect(await harness.metadata(binding)).toMatchObject({ version: 1 });
      expect(harness.calls).toHaveLength(1);
      expect(await keepAliveReferences(binding)).toBe(0);
    } finally {
      release.resolve(completedResponse());
      renewed?.socket.close();
      await harness.setConfiguration(syntheticPrivateDiscoveryConfiguration);
    }
  });

  it("detaches an HTTP delivery and replays the same durable run after a real socket reconnect", async () => {
    harness.clearCalls();
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const binding = await harness.binding();
    const original = await harness.open(binding);
    const attempt = await harness.startTurn(original);
    await expect.poll(() => harness.calls.length).toBe(1);
    original.socket.close();
    const detached = await attempt.finished;
    expect(detached).not.toContain(proposalText);
    const renewed = await harness.open(binding);
    expect(renewed.generation).not.toBe(original.generation);
    expect(await harness.hydrate(renewed)).toMatchObject({
      activeRun: { runId: attempt.turnId },
      messages: [{ role: "user" }],
    });
    await expectRejected(replay(original, attempt.turnId), 403);
    const resumed = await replay(renewed, attempt.turnId);
    expect(resumed.status).toBe(200);
    const finished = resumed.text();
    release.resolve(completedResponse());
    expect(await finished).toContain("RUN_FINISHED");
    const accepted = await expectAcceptedOnce(renewed, attempt.turnId);
    const repeated = await replay(renewed, attempt.turnId);
    expect(repeated.status).toBe(200);
    expect(await repeated.text()).toContain("RUN_FINISHED");
    expect(await harness.hydrate(renewed)).toEqual(accepted);
    expect(harness.calls).toHaveLength(1);
    renewed.socket.close();
  });

  it("preserves the active run through pending B and accepted C while rejecting stale B authorization", async () => {
    harness.clearCalls();
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const binding = await harness.binding();
    const active = await harness.open(binding);
    const attempt = await harness.startTurn(active);
    await expect.poll(() => harness.calls.length).toBe(1);
    // The actual production begin call retires A; withholding authorize keeps B pending.
    const pendingGeneration = await beginPending(binding);
    expect(await lifecycle(binding)).toMatchObject({
      generation: pendingGeneration,
      status: "pending",
    });
    expect(await attempt.finished).not.toContain(proposalText);
    const renewed = await harness.open(binding);
    expect(renewed.generation).not.toBe(pendingGeneration);
    const attempts = await harness.turns(binding);
    expect(attempts).toMatchObject([
      { generation: renewed.generation, id: attempt.turnId, status: "running" },
    ]);
    await expectRejected(authorize(binding, pendingGeneration), 409);
    await expectRejected(
      harness.command({
        action: "connect",
        generation: pendingGeneration,
        sessionReference: binding.sessionReference,
      }),
      403
    );
    await expectRejected(
      harness.chatRequest(renewed, {
        generation: pendingGeneration,
        method: "GET",
        query: `?runId=${attempt.turnId}`,
      }),
      403
    );
    expect(await lifecycle(binding)).toMatchObject({
      generation: renewed.generation,
      status: "connected",
    });
    const resumed = await replay(renewed, attempt.turnId);
    expect(resumed.status).toBe(200);
    const finished = resumed.text();
    release.resolve(completedResponse());
    expect(await finished).toContain("RUN_FINISHED");
    await expectAcceptedOnce(renewed, attempt.turnId);
    renewed.socket.close();
  });

  it.each([
    { scope: "account", state: "detached" },
    { scope: "household", state: "detached" },
    { scope: "account", state: "pending" },
    { scope: "household", state: "pending" },
  ] as const)(
    "cannot revive a $state run after explicit $scope revocation",
    async ({ scope, state }) => {
      harness.clearCalls();
      const release = Promise.withResolvers<LocalResponse>();
      harness.setModelResponse(() => release.promise);
      const binding = await harness.binding();
      const original = await harness.open(binding);
      const attempt = await harness.startTurn(original);
      await expect.poll(() => harness.calls.length).toBe(1);
      let retiredGeneration = original.generation;
      if (state === "pending") {
        retiredGeneration = await beginPending(binding);
      } else {
        original.socket.close();
      }
      expect(await attempt.finished).not.toContain(proposalText);
      const operation = await mutation(binding, scope);
      const invalidated = await harness.turns(binding);
      expect(invalidated).toMatchObject([
        {
          failure: "connection_lost",
          id: attempt.turnId,
          status: "interrupted",
          summary: null,
        },
      ]);
      await expectRejected(authorize(binding, retiredGeneration), 409);
      await expectRejected(
        harness.chatRequest(original, {
          generation: retiredGeneration,
          method: "GET",
          query: `?runId=${attempt.turnId}`,
        }),
        403
      );
      release.resolve(completedResponse());
      await harness.successful({ ...operation, action: "mutation-complete" });
      const renewed = await harness.open(binding);
      const resumed = await replay(renewed, attempt.turnId);
      expect(resumed.status).toBe(200);
      const terminal = await resumed.text();
      expect(terminal).not.toContain(proposalText);
      expect(terminal).not.toContain("RUN_FINISHED");
      const duplicate = await harness.chatRequest(renewed, {
        body: attempt.input,
        method: "POST",
      });
      expect(duplicate.status).toBe(200);
      expect(await duplicate.text()).not.toContain(proposalText);
      expect(await harness.hydrate(renewed)).toMatchObject({
        activeRun: null,
        messages: [{ role: "user" }],
      });
      expect(await cards(renewed)).toMatchObject({ cards: [] });
      expect(await harness.turns(binding)).toMatchObject([
        {
          failure: "connection_lost",
          id: attempt.turnId,
          status: "interrupted",
          summary: null,
        },
      ]);
      expect(await harness.metadata(binding)).toMatchObject({ version: 1 });
      expect(harness.calls).toHaveLength(1);
      renewed.socket.close();
    }
  );
});
