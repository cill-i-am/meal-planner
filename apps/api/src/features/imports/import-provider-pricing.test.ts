import { describe, expect, it } from "vitest";

import { pricedTokenUsage } from "./import-provider-kernel.js";

describe("provider token pricing", () => {
  const prices = { inputMicroUsdPerToken: 0.1, outputMicroUsdPerToken: 0 };

  it("prices an input-only provider from its billed input tokens", () => {
    expect(pricedTokenUsage(655, 0, prices)).toEqual({
      _tag: "Known",
      actualCostMicroUsd: 66,
    });
  });

  it("accepts a reported zero input count when output usage is positive", () => {
    expect(
      pricedTokenUsage(0, 10, {
        inputMicroUsdPerToken: 0.29,
        outputMicroUsdPerToken: 2.25,
      })
    ).toEqual({ _tag: "Known", actualCostMicroUsd: 23 });
  });

  it.each([
    [undefined, 0],
    [1, undefined],
    [0, 0],
    [-1, 0],
    [1.5, 0],
    [Number.MAX_SAFE_INTEGER + 1, 0],
    [1, Number.NaN],
  ])(
    "keeps incomplete or untrustworthy usage unknown (%s, %s)",
    (input, output) => {
      expect(pricedTokenUsage(input, output, prices)).toEqual({
        _tag: "Unknown",
      });
    }
  );
});
