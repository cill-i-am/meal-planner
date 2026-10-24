import { CanonicalTikTokUrl } from "@meal-planner/recipe-import-api";
import { Effect, Schema } from "effect";

import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import type { HouseholdReadRecipeImportSubmissionInput } from "../households/recipe-import/household-recipe-import.contract.js";
import { workflowMutationId } from "./import-workflow-mutation.js";
import { SourceDescriptor } from "./import.contracts.js";
import type { CanonicalIdentityResolution } from "./source-identity.js";

/**
 * Native workflow startup adapter. The host supplies its bound household RPC and
 * task-scoped resolver so the resolver's R keeps Cloudflare's workflow context
 * visible to the enclosing handler. The ordinary resolver service cannot carry
 * those native task requirements. This deliberate runtime seam lets native RPC
 * tests exercise the production startup order without unrelated provider bindings.
 */
export const prepareImportWorkflowSource = <E, R>(input: {
  readonly submission: HouseholdReadRecipeImportSubmissionInput;
  readonly householdDomain: Pick<
    HouseholdDomainWorkerMethods,
    "readRecipeImportSubmission" | "resolveRecipeImportSource"
  >;
  readonly resolveIdentity: (
    source: SourceDescriptor
  ) => Effect.Effect<CanonicalIdentityResolution, E, R>;
}) =>
  Effect.gen(function* prepareSubmittedImportSource() {
    const { admission, expectedGeneration, intentId } = input.submission;
    const submission = yield* input.householdDomain.readRecipeImportSubmission(
      input.submission
    );
    const source = yield* Schema.decodeUnknownEffect(SourceDescriptor, {
      onExcessProperty: "error",
    })({ kind: "tiktok", url: submission.submittedSourceUrl });
    const identityResolution = yield* input.resolveIdentity(source);
    const mutationId = yield* workflowMutationId(
      `${intentId}:${expectedGeneration}:resolve-source:${identityResolution.identity.canonicalId}`
    );
    const canonicalUrl = yield* Schema.decodeUnknownEffect(CanonicalTikTokUrl)(
      identityResolution.canonicalUrl
    );
    const resolvedIntent =
      yield* input.householdDomain.resolveRecipeImportSource({
        admission,
        canonicalSourceId: identityResolution.identity.canonicalId,
        canonicalUrl,
        expectedGeneration,
        intentId,
        mutationId,
        sourceKind:
          identityResolution._tag === "VideoIdentity" ? "video" : "carousel",
      });
    return { identityResolution, resolvedIntent };
  });
