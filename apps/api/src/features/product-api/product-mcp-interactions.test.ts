import { setTimeout as delay } from "node:timers/promises";

import {
  CreateTaskResultV2Schema,
  GetTaskResultV2Schema,
  InputRequiredCallToolResultV2Schema,
} from "@modelcontextprotocol/ext-tasks/core/v2";
import { ProtocolError } from "@modelcontextprotocol/server";
import { Clock, Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  confirmArguments,
  createArguments,
  intentId,
  makeImportTransportFixture,
} from "./product-mcp-interactions.test-fixture.js";
import type { ProductMcpDispatch } from "./product-mcp-tools.js";
import { handleProductMcp } from "./product-mcp.js";

const capabilities = {
  elicitation: { form: {} },
  extensions: { "io.modelcontextprotocol/tasks": {} },
};
const Reply = Schema.Struct({
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Number,
      data: Schema.optional(Schema.Unknown),
      message: Schema.String,
    })
  ),
  result: Schema.optional(Schema.Unknown),
});
type Fixture = ReturnType<typeof makeImportTransportFixture>;
type Connection = Parameters<Fixture["dispatch"]>[0];

/** A fresh server and signed-state service per HTTP request, as in production. */
const rpc = async (
  fixture: Fixture,
  method: string,
  params: Record<string, unknown>,
  options: {
    capabilities?: object;
    connection?: Connection;
    dispatchCall?: ProductMcpDispatch["call"];
    legacy?: boolean;
    now?: number;
    signal?: AbortSignal;
  } = {}
) => {
  const routing = Schema.decodeUnknownSync(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      taskId: Schema.optional(Schema.String),
    })
  )(params);
  const name = routing.name ?? routing.taskId;
  const requestParams = { ...params };
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": options.legacy ? "2025-11-25" : "2026-07-28",
  });
  if (!options.legacy) {
    headers.set("mcp-method", method);
    if (name !== undefined) {
      headers.set("mcp-name", name);
    }
    requestParams["_meta"] = {
      "io.modelcontextprotocol/clientCapabilities":
        options.capabilities ?? capabilities,
      "io.modelcontextprotocol/clientInfo": {
        name: "transport-proof",
        version: "1",
      },
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    };
  }
  const request = new Request("https://ceird.app/mcp", {
    body: JSON.stringify({
      id: crypto.randomUUID(),
      jsonrpc: "2.0",
      method,
      params: requestParams,
    }),
    headers,
    method: "POST",
    signal: options.signal ?? null,
  });
  const program = fixture.dispatch(options.connection).pipe(
    Effect.flatMap((dispatch) =>
      handleProductMcp(
        request,
        options.dispatchCall === undefined
          ? dispatch
          : { ...dispatch, call: options.dispatchCall }
      )
    ),
    Effect.scoped
  );
  const response = await Effect.runPromise(
    options.now === undefined
      ? program
      : Clock.clockWith((clock) =>
          program.pipe(
            Effect.provideService(Clock.Clock, {
              currentTimeMillis: Effect.succeed(options.now ?? 0),
              currentTimeMillisUnsafe: () => options.now ?? 0,
              currentTimeNanos: clock.currentTimeNanos,
              currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
              monotonicTimeNanos: clock.monotonicTimeNanos,
              monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
              sleep: (duration) => clock.sleep(duration),
            })
          )
        )
  );
  const text = await response.text();
  const encoded = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : text;
  if (encoded === undefined) {
    throw new Error(`No JSON-RPC reply: ${text}`);
  }
  return {
    ...Schema.decodeUnknownSync(Reply)(JSON.parse(encoded)),
    wire: text,
  };
};
const createTask = async (fixture: Fixture) => {
  const reply = await rpc(fixture, "tools/call", {
    arguments: createArguments,
    name: "recipe_import_intents_create",
  });
  return CreateTaskResultV2Schema.parse(reply.result);
};
const readTask = async (fixture: Fixture, taskId: string) => {
  const reply = await rpc(fixture, "tasks/get", { taskId });
  return GetTaskResultV2Schema.parse(reply.result);
};
const challenge = async (fixture: Fixture) => {
  const reply = await rpc(fixture, "tools/call", {
    arguments: confirmArguments,
    name: "recipe_import_intents_confirm_action",
  });
  return InputRequiredCallToolResultV2Schema.parse(reply.result);
};
const resume = (
  fixture: Fixture,
  requestState: string | undefined,
  answer: object,
  args: object = confirmArguments,
  connection?: Connection
) => {
  const params: Record<string, unknown> = {
    arguments: args,
    inputResponses: { publish: answer },
    name: "recipe_import_intents_confirm_action",
  };
  if (requestState !== undefined) {
    params["requestState"] = requestState;
  }
  return rpc(fixture, "tools/call", params, { connection });
};

describe("MCP import HTTP transport with schema-validated domain responses", () => {
  it("waits for the dispatched operation's resource cleanup when the HTTP request is aborted", async () => {
    const fixture = makeImportTransportFixture();
    const admitted = Promise.withResolvers<null>();
    const cleanup = Promise.withResolvers<null>();
    const owner = new AbortController();
    let finalized = false;
    const completed = rpc(
      fixture,
      "tools/call",
      {
        arguments: {},
        name: "families_list",
      },
      {
        dispatchCall: () =>
          Effect.acquireRelease(
            Effect.sync(() => admitted.resolve(null)),
            () =>
              Effect.promise(async () => {
                await delay(80);
                finalized = true;
                cleanup.resolve(null);
              })
          ).pipe(
            Effect.flatMap(() => Effect.never),
            Effect.scoped
          ),
        signal: owner.signal,
      }
    ).then(
      () => finalized,
      () => finalized
    );
    await admitted.promise;
    owner.abort();
    const finalizedBeforeCompletion = await completed;
    await cleanup.promise;
    expect(finalizedBeforeCompletion).toBe(true);
  });

  it.each([
    { error: new Error("private-diagnostic-sentinel"), name: "Error" },
    {
      error: new ProtocolError(-32_603, "private-diagnostic-sentinel"),
      name: "ProtocolError defect",
    },
  ])("redacts unexpected $name defects", async ({ error }) => {
    const fixture = makeImportTransportFixture();
    const params = { arguments: {}, name: "families_list" };
    const defect = await rpc(fixture, "tools/call", params, {
      dispatchCall: () => Effect.die(error),
    });
    expect(defect.error).toMatchObject({ code: -32_603 });
    expect(defect.wire).not.toContain("private-diagnostic-sentinel");
  });

  it("preserves a deliberate typed protocol failure from interaction validation", async () => {
    const fixture = makeImportTransportFixture();
    const intentional = await rpc(fixture, "tasks/get", {
      taskId: "invalid-signed-state",
    });
    expect(intentional.error).toEqual({
      code: -32_602,
      message: "Invalid, expired or inaccessible import interaction.",
    });
  });

  it("recovers the original import and preserves its first terminal outcome after later cancellation", async () => {
    const fixture = makeImportTransportFixture();
    const task = await createTask(fixture);
    expect(task.status).toBe("working");
    expect(await createTask(fixture)).toMatchObject({ taskId: task.taskId });
    expect(fixture.creationReceipts.size).toBe(1);
    expect(await readTask(fixture, task.taskId)).toMatchObject({
      status: "working",
    });
    fixture.ready();
    const completed = await readTask(fixture, task.taskId);
    expect(completed).toMatchObject({
      result: {
        isError: false,
        structuredContent: { intentId, type: "draft_ready" },
      },
      status: "completed",
    });
    fixture.cancelDomain();
    expect(await readTask(fixture, task.taskId)).toEqual(completed);
    expect(
      await rpc(fixture, "tasks/cancel", { taskId: task.taskId })
    ).toMatchObject({ result: { resultType: "complete" } });
    expect(fixture.cancellations).toHaveLength(0);
  });

  it("checks signed owner/client, current scopes and membership on task reads", async () => {
    const fixture = makeImportTransportFixture();
    const { taskId } = await createTask(fixture);
    await Promise.all(
      [
        { clientId: "other-client", userId: "transport-user" },
        { clientId: "transport-client", userId: "other-user" },
      ].map(async (owner) => {
        expect(
          await rpc(fixture, "tasks/get", { taskId }, { connection: { owner } })
        ).toMatchObject({ error: expect.anything() });
      })
    );
    expect(
      await rpc(
        fixture,
        "tasks/get",
        { taskId },
        {
          connection: { scopes: ["meal-planner:write"] },
        }
      )
    ).toMatchObject({ error: expect.anything() });
    fixture.revokeMembership();
    expect(await rpc(fixture, "tasks/get", { taskId })).toMatchObject({
      error: expect.anything(),
    });
  });

  it("cancels working imports at the current version and ignores valid update input", async () => {
    const fixture = makeImportTransportFixture();
    const { taskId } = await createTask(fixture);
    expect(
      await rpc(fixture, "tasks/update", {
        inputResponses: {
          arbitrary: { action: "accept", content: { publish: true } },
        },
        taskId,
      })
    ).toMatchObject({ result: { resultType: "complete" } });
    expect(fixture.getPublications()).toBe(0);
    expect(await readTask(fixture, taskId)).toMatchObject({
      status: "working",
    });
    expect(await rpc(fixture, "tasks/cancel", { taskId })).toMatchObject({
      result: { resultType: "complete" },
    });
    expect(fixture.cancellations).toEqual([
      { expectedIntentVersion: 1, key: expect.any(String) },
    ]);
    expect(await readTask(fixture, taskId)).toMatchObject({
      status: "cancelled",
    });
    await rpc(fixture, "tasks/cancel", { taskId });
    expect(fixture.cancellations).toHaveLength(1);
    fixture.revokeMembership();
    expect(
      await rpc(fixture, "tasks/update", { inputResponses: {}, taskId })
    ).toMatchObject({ error: expect.anything() });
  });

  it("returns domain failure as a completed error and returns redirects without following them", async () => {
    const failed = makeImportTransportFixture();
    const failedTask = await createTask(failed);
    failed.fail();
    expect(await readTask(failed, failedTask.taskId)).toMatchObject({
      result: {
        isError: true,
        structuredContent: { code: "analysis_failed", type: "failed" },
      },
      status: "completed",
    });
    const redirected = makeImportTransportFixture();
    const redirectedTask = await createTask(redirected);
    redirected.redirect();
    expect(await readTask(redirected, redirectedTask.taskId)).toMatchObject({
      result: { structuredContent: { type: "redirected" } },
      status: "completed",
    });
    expect(
      redirected.requests.every(({ path }) => !path.endsWith("000000000009"))
    ).toBe(true);
  });

  it("keeps the cancellation identity while reloading a version changed by concurrent progress", async () => {
    const fixture = makeImportTransportFixture();
    const { taskId } = await createTask(fixture);
    fixture.raceNextCancellation();
    const conflicted = await rpc(fixture, "tasks/cancel", { taskId });
    expect(conflicted.error).toBeDefined();
    expect(await readTask(fixture, taskId)).toMatchObject({
      status: "working",
    });
    const retried = await rpc(fixture, "tasks/cancel", { taskId });
    expect(retried.result).toMatchObject({ resultType: "complete" });
    expect(fixture.cancellations).toEqual([
      { expectedIntentVersion: 1, key: expect.any(String) },
      { expectedIntentVersion: 2, key: fixture.cancellations[0]?.key },
    ]);
    expect(await readTask(fixture, taskId)).toMatchObject({
      status: "cancelled",
    });
  });

  it("does not create again automatically after losing the admission response", async () => {
    const fixture = makeImportTransportFixture();
    fixture.loseNextCreateResponse();
    const first = await rpc(fixture, "tools/call", {
      arguments: createArguments,
      name: "recipe_import_intents_create",
    });
    expect(
      first.error !== undefined ||
        Schema.is(Schema.Struct({ isError: Schema.Literal(true) }))(
          first.result
        )
    ).toBe(true);
    expect(
      fixture.requests.filter(({ method }) => method === "POST")
    ).toHaveLength(1);
    await createTask(fixture);
    expect(fixture.creationReceipts.size).toBe(1);
    expect(
      fixture.requests.filter(({ method }) => method === "POST")
    ).toHaveLength(2);
  });

  it("shows the complete review and binds acceptance to its original command receipt", async () => {
    const fixture = makeImportTransportFixture();
    fixture.ready();
    const review = await challenge(fixture);
    expect(review.inputRequests?.["publish"]).toMatchObject({
      method: "elicitation/create",
    });
    const prompt = Schema.decodeUnknownSync(
      Schema.Struct({
        params: Schema.Struct({ message: Schema.String }),
      })
    )(review.inputRequests?.["publish"]);
    const preview = prompt.params.message.slice(
      prompt.params.message.indexOf("\n\n") + 2
    );
    expect(JSON.parse(preview)).toEqual(fixture.review);
    expect(fixture.getPublications()).toBe(0);
    const accepted = await resume(
      fixture,
      review.requestState,
      {
        action: "accept",
        content: { publish: true },
      },
      confirmArguments,
      { scopes: ["meal-planner:write"] }
    );
    expect(accepted.error).toBeUndefined();
    expect(accepted.result).toMatchObject({
      isError: false,
      resultType: "complete",
    });
    expect(fixture.getPublications()).toBe(1);
    const retried = await resume(fixture, review.requestState, {
      action: "accept",
      content: { publish: true },
    });
    expect(retried.result).toEqual(accepted.result);
    expect(fixture.getPublications()).toBe(1);
  });

  it.each([
    { action: "decline" },
    { action: "decline", content: {} },
    { action: "cancel" },
    { action: "cancel", content: { publish: true } },
    { action: "accept", content: { publish: false } },
  ])("leaves the draft untouched for $action/$content", async (answer) => {
    const fixture = makeImportTransportFixture();
    fixture.ready();
    const review = await challenge(fixture);
    const reply = await resume(fixture, review.requestState, answer);
    expect(reply.error).toBeUndefined();
    expect(fixture.getStatus()).toBe("requires_action");
    expect(fixture.getPublications()).toBe(0);
    expect(
      fixture.requests.filter(({ method }) => method === "POST")
    ).toHaveLength(0);
  });

  it("rejects continuation tampering, changed commands, another client and unsigned input", async () => {
    const fixture = makeImportTransportFixture();
    fixture.ready();
    const review = await challenge(fixture);
    const accept = { action: "accept", content: { publish: true } };
    await Promise.all(
      [
        { ...confirmArguments, familyId: "another-family" },
        { ...confirmArguments, input: { expectedActionVersion: 2 } },
        { ...confirmArguments, headers: { "idempotency-key": "changed-key" } },
      ].map(async (args) => {
        expect(
          await resume(fixture, review.requestState, accept, args)
        ).toMatchObject({ error: expect.anything() });
      })
    );
    expect(
      await resume(fixture, `${review.requestState}x`, accept)
    ).toMatchObject({ error: expect.anything() });
    expect(await resume(fixture, undefined, accept)).toMatchObject({
      error: expect.anything(),
    });
    expect(
      await resume(fixture, review.requestState, {
        action: "accept",
        content: {},
      })
    ).toMatchObject({ error: expect.anything() });
    expect(
      await resume(fixture, review.requestState, accept, confirmArguments, {
        owner: { clientId: "other-client", userId: "transport-user" },
      })
    ).toMatchObject({ error: expect.anything() });
    expect(fixture.getPublications()).toBe(0);
  });

  it("acknowledges a signed decline after draft cancellation while rechecking membership", async () => {
    const fixture = makeImportTransportFixture();
    fixture.ready();
    const review = await challenge(fixture);
    fixture.cancelDomain();
    const declined = await resume(fixture, review.requestState, {
      action: "decline",
    });
    expect(declined.error).toBeUndefined();
    expect(declined.result).toMatchObject({
      isError: false,
      resultType: "complete",
    });
    expect(fixture.getStatus()).toBe("cancelled");
    expect(fixture.getPublications()).toBe(0);
    expect(
      fixture.requests.filter(({ method }) => method === "POST")
    ).toHaveLength(0);
    fixture.revokeMembership();
    const denied = await resume(fixture, review.requestState, {
      action: "decline",
    });
    expect(denied.error).toBeDefined();
    expect(fixture.getPublications()).toBe(0);
  });

  it("retains domain version conflicts when a reviewed action changes before acceptance", async () => {
    const fixture = makeImportTransportFixture();
    fixture.ready();
    const review = await challenge(fixture);
    fixture.changeReview();
    expect(
      await resume(fixture, review.requestState, {
        action: "accept",
        content: { publish: true },
      })
    ).toMatchObject({
      result: { isError: true, structuredContent: { httpStatus: 409 } },
    });
    expect(fixture.getPublications()).toBe(0);
  });

  it("rejects an expired signed review over the native continuation envelope", async () => {
    const fixture = makeImportTransportFixture();
    fixture.ready();
    const review = await challenge(fixture);
    const result = await rpc(
      fixture,
      "tools/call",
      {
        arguments: confirmArguments,
        inputResponses: {
          publish: { action: "accept", content: { publish: true } },
        },
        name: "recipe_import_intents_confirm_action",
        requestState: review.requestState,
      },
      { now: Date.now() + 11 * 60 * 1000 }
    );
    expect(result.error).toBeDefined();
    expect(fixture.getPublications()).toBe(0);
  });

  it("rechecks write permission and household membership before accepting a signed review", async () => {
    const fixture = makeImportTransportFixture();
    fixture.ready();
    const review = await challenge(fixture);
    const accept = { action: "accept", content: { publish: true } };
    const noWrite = await resume(
      fixture,
      review.requestState,
      accept,
      confirmArguments,
      {
        scopes: ["meal-planner:read"],
      }
    );
    expect(noWrite.result).toMatchObject({ isError: true });
    expect(
      fixture.requests.filter(({ method }) => method === "POST")
    ).toHaveLength(0);
    fixture.revokeMembership();
    const noMembership = await resume(fixture, review.requestState, accept);
    expect(noMembership.result).toMatchObject({
      isError: true,
      structuredContent: { httpStatus: 403 },
    });
    expect(fixture.getPublications()).toBe(0);
  });

  it("does not augment a task when its connection lacks read permission", async () => {
    const fixture = makeImportTransportFixture();
    const reply = await rpc(
      fixture,
      "tools/call",
      {
        arguments: createArguments,
        name: "recipe_import_intents_create",
      },
      { connection: { scopes: ["meal-planner:write"] } }
    );
    expect(reply.result).toMatchObject({
      isError: false,
      resultType: "complete",
    });
    expect(reply.result).not.toHaveProperty("taskId");
    expect(fixture.requests).toHaveLength(1);
  });

  it("keeps write-only form-capable clients on ordinary explicit confirmation", async () => {
    const fixture = makeImportTransportFixture();
    fixture.ready();
    const reply = await rpc(
      fixture,
      "tools/call",
      {
        arguments: confirmArguments,
        name: "recipe_import_intents_confirm_action",
      },
      { connection: { scopes: ["meal-planner:write"] } }
    );
    expect(reply.error).toBeUndefined();
    expect(reply.result).toMatchObject({
      isError: false,
      resultType: "complete",
    });
    expect(reply.result).not.toHaveProperty("inputRequests");
    expect(fixture.getPublications()).toBe(1);
  });

  it.each([{ capabilities: {} }, { legacy: true }])(
    "keeps unnegotiated modern and legacy clients on ordinary tool calls (%j)",
    async (options) => {
      const fixture = makeImportTransportFixture();
      const result = await rpc(
        fixture,
        "tools/call",
        {
          arguments: createArguments,
          name: "recipe_import_intents_create",
        },
        options
      );
      expect(result.error).toBeUndefined();
      expect(result.result).toMatchObject({
        isError: false,
        structuredContent: { httpStatus: 201 },
      });
      expect(result.result).not.toHaveProperty("taskId");
      fixture.ready();
      const confirmed = await rpc(
        fixture,
        "tools/call",
        {
          arguments: confirmArguments,
          name: "recipe_import_intents_confirm_action",
        },
        options
      );
      expect(confirmed.result).toMatchObject({ isError: false });
      expect(confirmed.result).not.toHaveProperty("inputRequests");
      expect(fixture.getPublications()).toBe(1);
    }
  );
});
