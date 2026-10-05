import { act, cleanup, renderHook } from "@testing-library/react";
import { Schema } from "effect";
import { afterEach, expect, it } from "vitest";

import { usePendingRequest, useSessionPendingRequest } from "./index.js";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
it("keeps one exact command for retries and releases only its own key", () => {
  const { result } = renderHook(() =>
    usePendingRequest<{ name: string }>("alice:family")
  );
  const command = { name: "Original" };
  act(() => {
    result.current.retain("first", command);
  });
  act(() => {
    expect(result.current.retain("second", { name: "Changed" })).toBe(command);
  });
  act(() => {
    result.current.release("second");
  });
  expect(result.current.pending).toBe(command);
  act(() => {
    result.current.release("first");
  });
  expect(result.current.pending).toBeUndefined();
});
it("does not carry commands across account/family changes or remounts", () => {
  const { result, rerender, unmount } = renderHook(
    ({ scope }) => usePendingRequest<string>(scope),
    { initialProps: { scope: "alice:family-1" } }
  );
  act(() => {
    result.current.retain("one", "private");
  });
  rerender({ scope: "bob:family-1" });
  expect(result.current.pending).toBeUndefined();
  rerender({ scope: "alice:family-1" });
  expect(result.current.pending).toBeUndefined();
  act(() => {
    result.current.retain("two", "another");
  });
  unmount();
  const fresh = renderHook(() => usePendingRequest<string>("alice:family-1"));
  expect(fresh.result.current.pending).toBeUndefined();
});

it("keeps an unreadable saved request and blocks a replacement write", () => {
  const key = "meal-planner.test:alice:family";
  sessionStorage.setItem(key, "{broken");
  const Request = Schema.Struct({ id: Schema.String, name: Schema.String });
  const { result } = renderHook(() =>
    useSessionPendingRequest(key, Request, (request) => request.id)
  );

  expect(result.current.error).toContain("could not be read");
  act(() => {
    expect(result.current.retain({ id: "new", name: "Replacement" })).toBe(
      false
    );
  });
  expect(sessionStorage.getItem(key)).toBe("{broken");
});
