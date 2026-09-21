import { describe, expect, it } from "vitest";

import { parseRetryAfter } from "./auth-errors.js";
import { decodeAuthSearch } from "./auth-navigation.js";

describe("auth return destinations", () => {
  it.each([
    "https://other.test",
    "//other.test",
    "/\\other.test",
    "/\t/other.test",
    "/login",
    "/family/../signup",
    "/forgot-password?redirect=/",
  ])("rejects external or recursive destination %s", (redirect) => {
    expect(decodeAuthSearch({ redirect })).toEqual({ redirect: "/" });
  });
  it("retains a local path, query and fragment", () => {
    expect(decodeAuthSearch({ redirect: "/?intentId=abc#review" })).toEqual({
      redirect: "/?intentId=abc#review",
    });
  });
  it.each([null, "-1", "NaN", "1.5", "Infinity", "99999999999"])(
    "rejects invalid retry duration %s",
    (value) => {
      expect(parseRetryAfter(value)).toBeUndefined();
    }
  );
  it("accepts the Better Auth delta-seconds header", () => {
    expect(parseRetryAfter("60")).toBe(60);
  });
});
