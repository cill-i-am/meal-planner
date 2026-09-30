import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { expect, it } from "vitest";

import { fromNativeWebResponse } from "./native-http-response.js";

it("forwards an immutable native SSE response without changing its stream or headers", async () => {
  const native = await fetch("data:text/event-stream,data%3A%20ready%0A%0A");
  expect(native.body).not.toBeNull();
  expect(() => native.headers.set("x-extra", "value")).toThrow(TypeError);

  const forwarded = HttpServerResponse.toWeb(fromNativeWebResponse(native));

  expect(forwarded.status).toBe(200);
  expect(forwarded.headers.get("content-type")).toBe("text/event-stream");
  expect(await forwarded.text()).toBe("data: ready\n\n");
});
