import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import { HouseholdSystemAdmission } from "../households/rpc/command-envelope.js";
import { ImportIntentExecutionGeneration } from "../households/shared-kernel/workflow-identity.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { persistHouseholdProviderTerminalAuthority } from "./import-provider-terminal-authority.js";
import { ImportTimestamp } from "./import.contracts.js";

interface WorkflowInstance {
  readonly status: () => Promise<{
    readonly status: string;
    readonly output?: unknown;
  }>;
  readonly restart: (options: {
    from: { name: string; type: "do" };
  }) => Promise<void>;
}
interface TestEnvironment {
  readonly TerminalWorkflow: {
    readonly create: (input: { id: string }) => Promise<WorkflowInstance>;
    readonly get: (id: string) => Promise<WorkflowInstance>;
  };
  readonly RESULTS: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
}
interface NativeStep {
  readonly do: <A>(
    name: string,
    config: { retries: { limit: number; delay: string; backoff: "constant" } },
    run: () => Promise<A>
  ) => Promise<A>;
}

const at = "2026-10-24T18:55:46.000Z";
const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "018f47ad-91aa-7c35-b6fe-000000000001"
);
const ownershipId = "a".repeat(64);
const inputFingerprint = "b".repeat(64);

/** Real native checkpoint serialization; household responses are scripted wire data. */
export class TerminalWorkflow extends WorkflowEntrypoint<TestEnvironment> {
  override async run(event: { instanceId: string }, step: NativeStep) {
    const owner = await step.do(
      "persist-visual-terminal-v1",
      { retries: { backoff: "constant", delay: "1 second", limit: 0 } },
      async () => {
        const count = Number(
          (await this.env.RESULTS.get(`${event.instanceId}:reads`)) ?? "0"
        );
        await this.env.RESULTS.put(
          `${event.instanceId}:reads`,
          String(count + 1)
        );
        return Effect.runPromise(
          persistHouseholdProviderTerminalAuthority({
            acquisitionGeneration: Schema.decodeUnknownSync(
              AcquisitionGeneration
            )(1),
            admission: Schema.decodeUnknownSync(HouseholdSystemAdmission)({
              actor: {
                _tag: "System",
                purpose: "recipe_import_lifecycle_commit",
              },
              organizationId: "terminal-test-family",
            }),
            executionGeneration: Schema.decodeUnknownSync(
              ImportIntentExecutionGeneration
            )(1),
            failAmbiguous: () =>
              Effect.die(
                "Settled failure must not dispatch or reconcile again"
              ),
            failure: {
              _tag: "Failed",
              code: "visual_extraction_failed",
              stage: "visual",
            },
            householdDomain: {
              readEvidenceStage: () =>
                Effect.succeed({
                  acquisitionAttemptGeneration: 1,
                  committedAt: at,
                  completedAt: at,
                  dispatchId: ownershipId,
                  executionGeneration: 1,
                  extractionContext: null,
                  failureCode: "visual_extraction_failed",
                  inputFingerprint,
                  intentId,
                  outcome: "Failed",
                  reference: null,
                  result: null,
                  stage: "visual",
                  startedAt: at,
                }),
              readImportTerminalCheckpoint: () =>
                Effect.succeed({
                  completedAt: at,
                  executionGeneration: 1,
                  failureCode: "visual_extraction_failed",
                  inputFingerprint,
                  intentId,
                  ownershipId,
                  stage: "visual",
                }),
            },
            intentId,
            now: () => Schema.decodeUnknownSync(ImportTimestamp)(at),
          })
        );
      }
    );
    await step.do(
      "after-checkpoint",
      { retries: { backoff: "constant", delay: "1 second", limit: 0 } },
      async () => {
        const count = Number(
          (await this.env.RESULTS.get(`${event.instanceId}:completions`)) ?? "0"
        );
        await this.env.RESULTS.put(
          `${event.instanceId}:completions`,
          String(count + 1)
        );
        return null;
      }
    );
    return { owner };
  }
}

export default {
  async fetch(request: Request, environment: TestEnvironment) {
    const url = new URL(request.url);
    const id = "terminal-checkpoint-test";
    if (url.pathname === "/start") {
      await environment.TerminalWorkflow.create({ id });
      return Response.json({ started: true });
    }
    const instance = await environment.TerminalWorkflow.get(id);
    if (url.pathname === "/replay") {
      await instance.restart({
        from: { name: "after-checkpoint", type: "do" },
      });
      return Response.json({ restarted: true });
    }
    return Response.json({
      completions: Number(await environment.RESULTS.get(`${id}:completions`)),
      reads: Number(await environment.RESULTS.get(`${id}:reads`)),
      workflow: await instance.status(),
    });
  },
};
