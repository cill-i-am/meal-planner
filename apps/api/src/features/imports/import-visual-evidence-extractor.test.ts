import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  MaximumVisualObservations,
  projectVisualProviderSemanticsInput,
  visualEvidenceProviderSchemas,
} from "./import-visual-evidence-extractor.js";

const observation = { confidence: 95, text: "2 onions" };

describe("visual frame response attribution", () => {
  it("preserves an empty middle slot and ignores model-owned frame identity", () => {
    const projected = projectVisualProviderSemanticsInput(
      {
        frames: [
          {
            observations: [
              { ...observation, frameIndex: 2, timestampMilliseconds: 999 },
            ],
          },
          { observations: [] },
          {
            frameIndex: 0,
            observations: [{ confidence: "90%", text: "serve" }],
          },
        ],
      },
      3
    );
    expect(projected).toEqual({
      frames: [
        { observations: [observation] },
        { observations: [] },
        { observations: [{ confidence: 90, text: "serve" }] },
      ],
    });
    expect(Schema.is(visualEvidenceProviderSchemas(3).schema)(projected)).toBe(
      true
    );
  });

  it.each([
    {
      frames: [
        { observations: [observation] },
        { observations: [observation] },
      ],
    },
    {
      frames: Array.from({ length: 4 }, () => ({
        observations: [observation],
      })),
    },
    { observations: [observation] },
  ])(
    "discards ambiguous frame slots instead of shifting attribution",
    (input) => {
      expect(projectVisualProviderSemanticsInput(input, 3)).toEqual({
        frames: [
          { observations: [] },
          { observations: [] },
          { observations: [] },
        ],
      });
    }
  );

  it("keeps a malformed slot empty without moving later evidence", () => {
    expect(
      projectVisualProviderSemanticsInput(
        { frames: [null, { observations: [observation] }] },
        2
      )
    ).toEqual({
      frames: [{ observations: [] }, { observations: [observation] }],
    });
  });

  it("bounds total observations across the entire multi-image response", () => {
    const result = projectVisualProviderSemanticsInput(
      {
        frames: Array.from({ length: 3 }, () => ({
          observations: Array.from(
            { length: MaximumVisualObservations },
            () => observation
          ),
        })),
      },
      3
    );
    expect(result.frames.map((frame) => frame.observations.length)).toEqual([
      MaximumVisualObservations,
      0,
      0,
    ]);
  });

  it("requires one output slot for every submitted image", () => {
    const schema = visualEvidenceProviderSchemas(3).toolSchema;
    expect(
      Schema.is(schema)({ frames: [{ observations: [observation] }] })
    ).toBe(false);
    expect(
      Schema.is(schema)({
        frames: Array.from({ length: 3 }, () => ({ observations: [] })),
      })
    ).toBe(true);
  });
});
