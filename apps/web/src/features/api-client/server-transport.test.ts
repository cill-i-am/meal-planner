import { expect, it } from "vitest";

import { serverApiRuntime } from "./server-transport.js";

it("forwards only the current request's credentials and returns refreshed cookies", async () => {
  const received: Request[] = [];
  const refreshed: string[][] = [];
  const api = {
    fetch: async (request: Request) => {
      received.push(request);
      return new Response(null, {
        headers: {
          "set-cookie": `session=${request.headers.get("cookie")}; HttpOnly`,
        },
      });
    },
  };
  const run = (identity: string) =>
    serverApiRuntime(
      new Request("https://meal.test/setup", {
        headers: { cookie: identity, origin: "https://meal.test" },
      }),
      api,
      (cookies) => refreshed.push([...cookies])
    ).fetch("https://meal.test/v1/families", {
      headers: { "cf-connecting-ip": "wrong-ip", cookie: "wrong-user" },
    });
  await Promise.all([run("alice"), run("bob")]);
  expect(received.map((request) => request.headers.get("cookie"))).toEqual([
    "alice",
    "bob",
  ]);
  expect(
    received.every(
      (request) => request.headers.get("cf-connecting-ip") === null
    )
  ).toBe(true);
  expect(
    received.every(
      (request) => request.headers.get("origin") === "https://meal.test"
    )
  ).toBe(true);
  expect(refreshed).toEqual([
    ["session=alice; HttpOnly"],
    ["session=bob; HttpOnly"],
  ]);
});

it("rejects off-origin and non-API requests before sending credentials", async () => {
  const received: Request[] = [];
  const runtime = serverApiRuntime(
    new Request("https://meal.test/setup", { headers: { cookie: "private" } }),
    {
      fetch: (request) => {
        received.push(request);
        return new Response();
      },
    },
    () => {}
  );
  await expect(runtime.fetch("https://other.test/v1/families")).rejects.toThrow(
    "only serves"
  );
  await expect(runtime.fetch("https://meal.test/not-an-api")).rejects.toThrow(
    "only serves"
  );
  expect(received).toHaveLength(0);
});

it.each(["incoming", "operation"] as const)(
  "propagates cancellation from the %s request",
  async (source) => {
    const incoming = new AbortController();
    const operation = new AbortController();
    const received: Request[] = [];
    const runtime = serverApiRuntime(
      new Request("https://meal.test/setup", { signal: incoming.signal }),
      {
        fetch: (request) => {
          received.push(request);
          return new Response();
        },
      },
      () => {}
    );
    await runtime.fetch("https://meal.test/v1/families", {
      signal: operation.signal,
    });
    (source === "incoming" ? incoming : operation).abort();
    expect(received[0]?.signal.aborted).toBe(true);
  }
);
