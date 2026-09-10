import {
  ProfileFactId,
  ProfileFactStanding,
  ProfileFactValue,
  ProfileVersion,
} from "@meal-planner/household-api";
import {
  ProfileCard,
  ProfileCardChange,
} from "@meal-planner/private-interview-api";
import type { Effect } from "effect";
import { Data, Schema } from "effect";

import {
  PrivateDiscoveryContinuity,
  PrivateDiscoveryContinuityUpdates,
  PrivateDiscoveryReply,
} from "./private-discovery-continuity.js";
import type { PrivateDiscoveryContinuationFailure } from "./private-discovery-continuity.js";

export const PRIVATE_DISCOVERY_CONTEXT_BYTES = 24_576;
export const PRIVATE_DISCOVERY_MESSAGE_LIMIT = 16;
export const PRIVATE_DISCOVERY_CARD_LIMIT = 25;
export const PRIVATE_DISCOVERY_PROMPT_VERSION = "private-discovery-prompt-v14";
export const PRIVATE_DISCOVERY_POLICY_VERSION = "private-discovery-policy-v2";
export const PRIVATE_DISCOVERY_TOOL_VERSION = "profile-card-change-v1";

const Id = Schema.String.pipe(Schema.check(Schema.isUUID()));
export const PrivateDiscoveryProfile = Schema.Struct({
  facts: Schema.Array(
    Schema.Struct({
      id: ProfileFactId,
      standing: ProfileFactStanding,
      value: ProfileFactValue,
    })
  ),
  version: ProfileVersion,
});
export type PrivateDiscoveryProfile = typeof PrivateDiscoveryProfile.Type;

/** Only the bound adult's own profile and this private session enter the model. */
export const PrivateDiscoveryContext = Schema.Struct({
  cards: Schema.Array(
    Schema.Struct({
      change: ProfileCardChange,
      id: Id,
      reviewedFact: Schema.NullOr(ProfileFactValue),
      revision: ProfileCard.fields.revision,
      status: Schema.Literals([
        "proposed",
        "rejected",
        "pending",
        "confirmed",
        "conflict",
      ]),
    })
  ).pipe(Schema.check(Schema.isMaxLength(PRIVATE_DISCOVERY_CARD_LIMIT))),
  continuity: PrivateDiscoveryContinuity,
  messages: Schema.Array(
    Schema.Struct({
      id: Id,
      role: Schema.Literals(["participant", "assistant"]),
      text: Schema.String.pipe(
        Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4000))
      ),
    })
  ).pipe(Schema.check(Schema.isMaxLength(PRIVATE_DISCOVERY_MESSAGE_LIMIT))),
  profile: PrivateDiscoveryProfile,
});
export type PrivateDiscoveryContext = typeof PrivateDiscoveryContext.Type;

const ProposeProfileCard = Schema.Struct({
  _tag: Schema.Literal("ProposeProfileCard"),
  change: ProfileCardChange,
});
const ReviseProposedProfileCard = Schema.Struct({
  _tag: Schema.Literal("ReviseProposedProfileCard"),
  cardId: Id,
  change: ProfileCardChange,
  expectedRevision: ProfileCard.fields.revision,
});
const PrivateDiscoveryProposal = Schema.Union([
  ProposeProfileCard,
  ReviseProposedProfileCard,
]).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

const outputSchema = <S extends Schema.Constraint>(proposal: S) =>
  Schema.Struct({
    continuity: PrivateDiscoveryContinuityUpdates,
    proposals: Schema.Array(proposal).pipe(Schema.check(Schema.isMaxLength(3))),
    reply: PrivateDiscoveryReply,
  }).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

/** Model text and unfinished proposals have no canonical authority. */
export const PrivateDiscoveryOutput = outputSchema(PrivateDiscoveryProposal);
export type PrivateDiscoveryOutput = typeof PrivateDiscoveryOutput.Type;

/** Narrows provider choices; canonical decoding and native revision checks still apply. */
export const makePrivateDiscoveryProviderOutput = (
  cards: PrivateDiscoveryContext["cards"]
) => {
  const eligibleIds = cards
    .filter((card) => card.status === "proposed")
    .map((card) => card.id);
  const proposal =
    eligibleIds.length === 0
      ? ProposeProfileCard
      : Schema.Union([
          ProposeProfileCard,
          Schema.Struct({
            ...ReviseProposedProfileCard.fields,
            cardId: Schema.Literals(eligibleIds),
          }),
        ]);
  return outputSchema(proposal);
};

const TokenCount = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);
export const PrivateDiscoveryUsage = Schema.Struct({
  estimatedCostUsd: Schema.NullOr(Schema.Number),
  inputTokens: Schema.NullOr(TokenCount),
  outputTokens: Schema.NullOr(TokenCount),
});
export type PrivateDiscoveryUsage = typeof PrivateDiscoveryUsage.Type;
export const PrivateDiscoveryProvenance = Schema.Struct({
  model: Schema.String,
  policyVersion: Schema.String,
  promptVersion: Schema.String,
  provider: Schema.Literal("cloudflare-workers-ai"),
  toolVersion: Schema.String,
});
export type PrivateDiscoveryProvenance = typeof PrivateDiscoveryProvenance.Type;
export const PrivateDiscoveryResult = Schema.Struct({
  output: PrivateDiscoveryOutput,
  provenance: PrivateDiscoveryProvenance,
  usage: PrivateDiscoveryUsage,
});
export type PrivateDiscoveryResult = typeof PrivateDiscoveryResult.Type;

export type PrivateDiscoveryInvalidOutputStage =
  | PrivateDiscoveryContinuationFailure["stage"]
  | "context_preparation"
  | "response_body_missing"
  | "response_body_limit"
  | "response_body_read"
  | "response_json"
  | "response_envelope"
  | "incomplete_completion"
  | "missing_content"
  | "output_json"
  | "output_schema"
  | "proposal_unknown_fact"
  | "proposal_revision_target"
  | "proposal_duplicate"
  | "proposal_fact_kind"
  | "proposal_already_confirmed"
  | "proposal_review";

export class PrivateDiscoveryFailure extends Data.TaggedError(
  "PrivateDiscoveryFailure"
)<{
  readonly reason:
    | "not_configured"
    | "provider_unavailable"
    | "invalid_output"
    | "refused"
    | "context_limit"
    | "outcome_unknown";
  readonly stage: PrivateDiscoveryInvalidOutputStage | null;
  readonly usage: PrivateDiscoveryUsage | null;
  readonly provenance: PrivateDiscoveryProvenance | null;
}> {}

export interface PrivateDiscoveryModel {
  readonly generate: (input: {
    readonly beforeDispatch: (provenance: PrivateDiscoveryProvenance) => void;
    readonly context: PrivateDiscoveryContext;
    readonly signal: AbortSignal;
  }) => Effect.Effect<PrivateDiscoveryResult, PrivateDiscoveryFailure>;
}
