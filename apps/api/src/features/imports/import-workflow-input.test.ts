import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { decodeImportWorkflowInput } from "./import-workflow-input.js";

const importId = "00000000-0000-4000-8000-000000000188";
const correlationId = "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2188";

describe("import workflow input", () => {
  it("preserves the exact current generation and trace context", async () => {
    await expect(
      Effect.runPromise(
        decodeImportWorkflowInput({
          executionGeneration: 1,
          importId,
          trace: { correlationId },
        })
      )
    ).resolves.toEqual({
      executionGeneration: 1,
      importId,
      trace: { correlationId },
    });
  });

  it.each([
    ["generation", { importId, trace: { correlationId } }],
    ["trace", { executionGeneration: 1, importId }],
  ])(
    "rejects missing %s before downstream workflow work",
    async (_name, input) => {
      let downstreamCalls = 0;
      const exit = await Effect.runPromiseExit(
        decodeImportWorkflowInput(input).pipe(
          Effect.andThen(
            Effect.sync(() => {
              downstreamCalls += 1;
            })
          )
        )
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(downstreamCalls).toBe(0);
    }
  );

  it.each([
    {},
    { executionGeneration: 0, importId, trace: { correlationId } },
    { importId, sourceUrl: "sensitive-source-sentinel" },
    { correlationId, importId, transcript: "sensitive-text-sentinel" },
    {
      importId,
      trace: { correlationId, sourceUrl: "sensitive-source-sentinel" },
    },
    {
      executionGeneration: 1,
      importId,
      resume: "prepared_visual_recovery",
      trace: { correlationId },
    },
    { correlationId: "not-a-uuid", importId },
    { importId: "not-a-uuid" },
  ])("rejects invalid or excess input %#", async (input) => {
    const exit = await Effect.runPromiseExit(decodeImportWorkflowInput(input));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).not.toContain("sensitive");
  });
});
