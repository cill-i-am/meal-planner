import { describe, expect, it } from "vitest";

import { decodePrivateDiscoveryKimiStream } from "./private-discovery-kimi-stream.js";
import {
  kimiChunk,
  kimiEvent,
} from "./private-discovery-kimi-stream.test-fixtures.js";

const choice = (
  delta: Readonly<Record<string, unknown>>,
  finishReason: string | null = null
) => ({ delta, finish_reason: finishReason, index: 0 });
const event = (
  delta: Readonly<Record<string, unknown>>,
  finishReason: string | null = null
) => kimiEvent(kimiChunk([choice(delta, finishReason)]));
const tool = {
  function: { arguments: '{"meal":"🍅"}', name: "submitDiscoveryTurn" },
  id: "call-1",
  index: 0,
  type: "function",
};
const opening = event({ role: "assistant", tool_calls: [tool] });
const terminal = event({}, "tool_calls");
const usage = { completion_tokens: 50, prompt_tokens: 100 };
const usageEvent = kimiEvent(kimiChunk([], usage));
const done = "data: [DONE]\n\n";
const complete = opening + terminal + usageEvent + done;

describe("Kimi discovery SSE protocol", () => {
  it("assembles documented ID/name/argument deltas without adding reasoning to the call", () => {
    const decoded = decodePrivateDiscoveryKimiStream(
      event({ reasoning_content: "private reasoning", role: "assistant" }) +
        event({
          tool_calls: [
            {
              ...tool,
              function: { arguments: '{"meal":', name: "submitDiscov" },
              id: "call-",
            },
          ],
        }) +
        event({
          tool_calls: [
            {
              function: { arguments: '"🍅"}', name: "eryTurn" },
              id: "1",
              index: 0,
            },
          ],
        }) +
        terminal +
        usageEvent +
        done
    );
    expect(decoded).toEqual({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: "",
            refusal: null,
            role: "assistant",
            tool_calls: [
              {
                function: tool.function,
                id: "call-1",
                type: "function",
              },
            ],
          },
        },
      ],
      usage,
    });
    expect(JSON.stringify(decoded)).not.toContain("private reasoning");
  });

  it.each(["\n", "\r", "\r\n"])(
    "supports SSE line ending %j, comments and multiline data",
    (ending) => {
      const body = `\uFEFF${complete}`
        .replaceAll('"object":', '\ndata: "object":')
        .replaceAll(
          "data: {",
          ": keepalive\nevent: message\nid: opaque\nretry: 5\ndata: {"
        )
        .replaceAll("\n", ending);
      expect(decodePrivateDiscoveryKimiStream(body)).toEqual(
        decodePrivateDiscoveryKimiStream(complete)
      );
    }
  );

  it("accepts consistent terminal choice usage and final usage once without summing details", () => {
    const body =
      opening +
      kimiEvent(
        kimiChunk([
          {
            ...choice({}, "tool_calls"),
            usage: { ...usage, total_tokens: 150 },
          },
        ])
      ) +
      kimiEvent(
        kimiChunk([], {
          ...usage,
          completion_tokens_details: { reasoning_tokens: 20 },
        })
      ) +
      done;
    expect(decodePrivateDiscoveryKimiStream(body).usage).toEqual(usage);
    expect(
      decodePrivateDiscoveryKimiStream(opening + terminal + done)
    ).not.toHaveProperty("usage");
  });

  it.each([
    { body: opening + terminal, name: "missing DONE" },
    { body: opening + done, name: "missing finish" },
    { body: complete.slice(0, -1), name: "unterminated DONE event" },
    { body: `${complete}data: {}`, name: "unterminated data after DONE" },
    { body: complete + opening, name: "data after DONE" },
    { body: complete + done, name: "duplicate DONE" },
    { body: opening + terminal + opening + done, name: "choice after finish" },
    {
      body: opening + usageEvent + terminal + done,
      name: "usage before finish",
    },
    {
      body: opening + terminal + usageEvent + usageEvent + done,
      name: "duplicate final usage",
    },
    {
      body: opening + terminal + kimiEvent(kimiChunk([])) + done,
      name: "empty choices without usage",
    },
    {
      body:
        opening +
        terminal +
        kimiEvent(kimiChunk([], { ...usage, completion_tokens: -1 })) +
        done,
      name: "negative usage",
    },
    {
      body:
        opening +
        kimiEvent(kimiChunk([{ ...choice({}, "tool_calls"), usage }])) +
        kimiEvent(kimiChunk([], { ...usage, prompt_tokens: 101 })) +
        done,
      name: "conflicting usage",
    },
    {
      body:
        opening +
        kimiEvent({
          ...kimiChunk([choice({}, "tool_calls")]),
          id: "different",
        }) +
        done,
      name: "conflicting completion ID",
    },
    {
      body:
        opening +
        kimiEvent({
          ...kimiChunk([choice({}, "tool_calls")]),
          model: "different",
        }) +
        done,
      name: "conflicting model",
    },
    {
      body:
        kimiEvent(kimiChunk([{ ...choice({ role: "assistant" }), index: 1 }])) +
        terminal +
        done,
      name: "second choice index",
    },
    {
      body: kimiEvent(kimiChunk([choice({}), choice({})])) + terminal + done,
      name: "multiple choices",
    },
    {
      body:
        event({ role: "assistant", tool_calls: [{ ...tool, index: 1 }] }) +
        terminal +
        done,
      name: "second tool index",
    },
    {
      body:
        event({ role: "assistant", tool_calls: [tool, tool] }) +
        terminal +
        done,
      name: "multiple tools",
    },
    {
      body: opening + event({ role: "user" }) + terminal + done,
      name: "changed role",
    },
    {
      body: event({ tool_calls: [tool] }) + terminal + done,
      name: "missing role",
    },
    {
      body:
        event({ role: "assistant", tool_calls: [{ ...tool, id: "" }] }) +
        terminal +
        done,
      name: "missing tool ID",
    },
    {
      body:
        event({
          role: "assistant",
          tool_calls: [{ ...tool, type: "custom" }],
        }) +
        terminal +
        done,
      name: "wrong tool type",
    },
    {
      body:
        opening +
        event({ function_call: { name: "another" } }) +
        terminal +
        done,
      name: "legacy function call",
    },
    {
      body: `event: error\n${opening}${terminal}${done}`,
      name: "non-message event",
    },
    { body: `data: {private-invalid\n\n${done}`, name: "malformed JSON" },
    { body: JSON.stringify({ choices: [] }), name: "non-SSE JSON" },
  ])("rejects $name without leaking stream data", ({ body }) => {
    expect(() => decodePrivateDiscoveryKimiStream(body)).toThrow();
    try {
      decodePrivateDiscoveryKimiStream(body);
    } catch (error) {
      expect(error).toMatchObject({ reason: "invalid_output", usage: null });
      expect(JSON.stringify(error)).not.toContain("private-invalid");
    }
  });
});
