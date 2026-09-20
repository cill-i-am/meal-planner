import { describe, expect, it } from "vitest";

import { fencePrivateChatResponse } from "./private-chat-delivery.js";

describe("private chat physical delivery", () => {
  it("does not prefill a private delivery queue before the reader asks", async () => {
    let authorized = true;
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("private reply"));
        },
      })
    );
    const response = fencePrivateChatResponse(
      upstream,
      () => authorized,
      new AbortController().signal
    );
    await Promise.resolve();
    await Promise.resolve();
    authorized = false;
    expect(await response.body?.getReader().read()).toEqual({
      done: true,
      value: undefined,
    });
  });

  it("drops a pending chunk when authority changes before its read completes", async () => {
    let authorized = true;
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          output = controller;
        },
      })
    );
    const response = fencePrivateChatResponse(
      upstream,
      () => authorized,
      new AbortController().signal
    );
    const read = response.body?.getReader().read();
    authorized = false;
    if (output === undefined) {
      throw new Error("Expected pending upstream");
    }
    output.enqueue(new TextEncoder().encode("private reply"));
    expect(await read).toEqual({ done: true, value: undefined });
  });

  it("cancels a blocked reader on explicit revocation", async () => {
    let detached = false;
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          detached = true;
        },
      })
    );
    const controller = new AbortController();
    const response = fencePrivateChatResponse(
      upstream,
      () => true,
      controller.signal
    );
    const read = response.body?.getReader().read();
    controller.abort();
    expect(await read).toEqual({ done: true, value: undefined });
    expect(detached).toBe(true);
  });

  it("rejects hydration before the response body can be delivered", async () => {
    const response = fencePrivateChatResponse(
      Response.json({ messages: ["private"] }),
      () => false,
      new AbortController().signal
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
  });
});
