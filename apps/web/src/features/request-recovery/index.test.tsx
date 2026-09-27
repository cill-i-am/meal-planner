import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { usePendingRequest } from "./index.js";

afterEach(cleanup);
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
