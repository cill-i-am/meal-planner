import { Data, Schema } from "effect";

const opaqueKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const operationId = Schema.String.pipe(Schema.check(Schema.isUUID()));

export const PrivateSessionBinding = Schema.Struct({
  accountKey: opaqueKey,
  householdKey: opaqueKey,
  linkageSubject: Schema.String,
  personId: Schema.String,
  sessionReference: operationId,
});
export type PrivateSessionBinding = typeof PrivateSessionBinding.Type;

export const OutputRegistration = Schema.Struct({
  childName: opaqueKey,
  generation: operationId,
});
export type OutputRegistration = typeof OutputRegistration.Type;

export const OutputMutationIntent = Schema.Struct({ intentKey: opaqueKey });
export type OutputMutationIntent = typeof OutputMutationIntent.Type;

export const OutputMutation = Schema.Struct({ operationId });
export type OutputMutation = typeof OutputMutation.Type;

export class PrivateOutputUnavailable extends Data.TaggedError(
  "PrivateOutputUnavailable"
)<{
  readonly reason:
    | "authority_unavailable"
    | "binding_conflict"
    | "mutation_pending"
    | "operation_conflict"
    | "output_disabled"
    | "unsupported_mutation";
}> {}

export interface OutputLifecyclePort {
  readonly beginMutation: (
    input: OutputMutationIntent
  ) => Promise<
    OutputMutation & { readonly phase: "fencing" | "ready" | "dispatched" }
  >;
  readonly readMutation: (input: OutputMutation) => Promise<{
    readonly phase: "fencing" | "ready" | "dispatched" | "settled";
  } | null>;
  readonly register: (input: OutputRegistration) => Promise<boolean>;
  readonly prepareMutation: (input: OutputMutation) => Promise<void>;
  readonly markDispatched: (input: OutputMutation) => Promise<void>;
  readonly completeMutation: (input: OutputMutation) => Promise<void>;
}

export const privateOutputKey = async (purpose: string, identity: string) => {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify(["private-output", 1, purpose, identity])
    )
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};
