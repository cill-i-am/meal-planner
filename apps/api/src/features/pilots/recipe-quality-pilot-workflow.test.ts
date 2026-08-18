import { Cause, Effect, Exit, Option } from "effect";
import type { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { decodeRecipeQualityPilotWorkflowStatus } from "./recipe-quality-pilot.js";

const expectInvalidResponse = async (input: Schema.Json) => {
  const exit = await Effect.runPromiseExit(
    decodeRecipeQualityPilotWorkflowStatus(input)
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected Workflow inspection failure");
  }
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
    _tag: "PilotWorkflowInspectionError",
    code: "invalid_workflow_response",
  });
};

describe("recipe quality pilot Workflow inspection", () => {
  it("decodes the installed current complete response output into a safe typed status", async () => {
    await expect(
      Effect.runPromise(
        decodeRecipeQualityPilotWorkflowStatus({
          end: "2026-07-27T10:00:00.000Z",
          output: JSON.stringify({
            _tag: "RetryExhausted",
            attempts: 3,
            generation: 3,
            stage: "container",
          }),
          start: "2026-07-27T09:59:00.000Z",
          status: "complete",
          stepCount: 3,
          success: true,
        })
      )
    ).resolves.toEqual({
      output: {
        code: null,
        stage: "container",
        tag: "RetryExhausted",
      },
      status: "complete",
    });
  });

  it("accepts an active installed response only when output is absent or null", async () => {
    await Promise.all(
      [
        { status: "running", stepCount: 1 },
        { output: null, status: "running", stepCount: 1 },
      ].map(async (input) => {
        await expect(
          Effect.runPromise(decodeRecipeQualityPilotWorkflowStatus(input))
        ).resolves.toEqual({
          output: null,
          status: "running",
        });
      })
    );
  });

  it("fails closed on missing, primitive, malformed, or undeclared output", async () => {
    await Promise.all([
      expectInvalidResponse({ status: "complete" }),
      expectInvalidResponse({ output: null, status: "complete" }),
      expectInvalidResponse({ output: 1, status: "complete" }),
      expectInvalidResponse({ output: "{", status: "complete" }),
      expectInvalidResponse({
        output: JSON.stringify({
          _tag: "RetryExhausted",
          attempts: 3,
          generation: 3,
          secret: "must-not-cross-the-inspection-boundary",
          stage: "container",
        }),
        status: "complete",
      }),
      expectInvalidResponse({
        output: JSON.stringify({ _tag: "NoAcquisitionRequired" }),
        status: "running",
      }),
      expectInvalidResponse({ output: null, status: "unexpected" }),
    ]);
  });

  it("returns one non-sensitive typed error for malformed response data", async () => {
    const unsafe = "provider-secret-fragment";
    const exit = await Effect.runPromiseExit(
      decodeRecipeQualityPilotWorkflowStatus({
        output: JSON.stringify({ _tag: unsafe }),
        status: "complete",
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).not.toContain(unsafe);
  });
});
