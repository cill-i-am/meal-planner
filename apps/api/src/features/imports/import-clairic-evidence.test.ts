import { describe, expect, it } from "vitest";

import {
  assembleClairicEvidenceText,
  resolveClairicEvidenceSpan,
} from "./import-clairic-evidence.js";
import type { RecipeEvidenceItem } from "./import-recipe-extractor.js";

const item = (
  value: string,
  evidenceId = "transcript"
): RecipeEvidenceItem => ({
  artifactReference: "private:transcript",
  evidenceId,
  kind: "transcript",
  origin: "creator_provided",
  value,
});

describe("Clairic evidence offsets", () => {
  it.each([
    [0, 1, "\uD83C"],
    [1, 2, "\uDF73"],
  ] as const)(
    "rejects UTF16 offsets inside a surrogate pair",
    (start, end, value) => {
      const evidence = assembleClairicEvidenceText([item("🍳")]);
      expect(
        resolveClairicEvidenceSpan({
          encoding: "utf16-code-units",
          evidence,
          returnedStateText: evidence.state,
          span: [start, end],
          value,
        })
      ).toBeNull();
    }
  );

  it.each([
    ["Chop onions.", "Ch", 0, 2],
    ["cafe\u0301", "cafe", 0, 4],
    ["chopped", "hopped", 1, 7],
  ] as const)(
    "rejects a provider span bisecting a word in %s",
    (state, value, start, end) => {
      const evidence = assembleClairicEvidenceText([item(state)]);
      expect(
        resolveClairicEvidenceSpan({
          encoding: "unicode-code-points",
          evidence,
          returnedStateText: state,
          span: [start, end],
          value,
        })
      ).toBeNull();
    }
  );

  it("preserves source bytes and disambiguates repeated text by source position", () => {
    const evidence = assembleClairicEvidenceText([
      item("Add milk.", "first"),
      item("Add milk.", "second"),
    ]);
    expect(evidence.state).toBe("Add milk.\n\nAdd milk.");
    expect(
      resolveClairicEvidenceSpan({
        encoding: "unicode-code-points",
        evidence,
        returnedStateText: evidence.state,
        span: [11, 20],
        value: "Add milk.",
      })
    ).toEqual({ end: 9, evidenceId: "second", start: 0, value: "Add milk." });
  });

  it("requires the declared encoding and exact returned text for Unicode", () => {
    const evidence = assembleClairicEvidenceText([
      item("🍳 cafe\u0301: ½\u00A0cup milk"),
    ]);
    const common = {
      evidence,
      returnedStateText: evidence.state,
      span: [9, 19] as const,
      value: "½\u00A0cup milk",
    };
    expect(
      resolveClairicEvidenceSpan({ ...common, encoding: "unicode-code-points" })
    ).toEqual({
      end: 20,
      evidenceId: "transcript",
      start: 10,
      value: "½\u00A0cup milk",
    });
    expect(
      resolveClairicEvidenceSpan({ ...common, encoding: "utf16-code-units" })
    ).toBeNull();
    expect(
      resolveClairicEvidenceSpan({
        ...common,
        encoding: "unicode-code-points",
        returnedStateText: evidence.state.normalize("NFC"),
      })
    ).toBeNull();
  });

  it("rejects a span crossing evidence boundaries even when its text matches", () => {
    const evidence = assembleClairicEvidenceText([
      item("2 cups"),
      item("milk"),
    ]);
    expect(
      resolveClairicEvidenceSpan({
        encoding: "unicode-code-points",
        evidence,
        returnedStateText: evidence.state,
        span: [0, 12],
        value: evidence.state,
      })
    ).toBeNull();
  });

  it.each([
    [-1, 3],
    [0, 99],
    [0.5, 3],
    [3, 2],
    [0, 0],
  ] as const)("rejects invalid offsets %s to %s", (start, end) => {
    const evidence = assembleClairicEvidenceText([item("milk")]);
    expect(
      resolveClairicEvidenceSpan({
        encoding: "unicode-code-points",
        evidence,
        returnedStateText: evidence.state,
        span: [start, end],
        value: "milk",
      })
    ).toBeNull();
  });
});
