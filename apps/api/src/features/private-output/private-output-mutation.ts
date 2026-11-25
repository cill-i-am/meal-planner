import type { AuthOutputFence } from "../auth/auth-output-fence.js";
import type { PrivateOutputMutationPort } from "./private-output-binding.js";
import {
  privateOutputKey,
  PrivateOutputUnavailable,
} from "./private-output.contract.js";

/** Settle this definite result; any ambiguous canonical operation keeps output fenced durably. */
export const runOutputFencedMutation = async <A>(
  output: PrivateOutputMutationPort,
  input: {
    readonly scope: "account" | "household";
    readonly key: string;
    readonly intentKey: string;
    /** Canonical callback guards every write with an immutable, atomic receipt. */
    readonly replayable?: true;
    /** Reconcile an existing intent without invalidating output for a new operation. */
    readonly reconcileOnly?: true;
  },
  canonical: () => Promise<A>
) => {
  const intent = {
    intentKey: input.intentKey,
    key: input.key,
    scope: input.scope,
  };
  const retained = input.reconcileOnly
    ? await output.findPendingMutation(intent)
    : await output.beginMutation(intent);
  if (retained === null) {
    const checkedResult: Awaited<Promise<A>> | Promise<A> = canonical();
    return checkedResult;
  }
  if (retained.phase === "dispatched" && !input.replayable) {
    throw new PrivateOutputUnavailable({ reason: "mutation_pending" });
  }
  const operation = {
    key: input.key,
    operationId: retained.operationId,
    scope: input.scope,
  };
  if (retained.phase !== "dispatched") {
    await output.prepareMutation(operation);
    await output.markDispatched(operation);
  }
  const result = await canonical();
  try {
    await output.completeMutation(operation);
  } catch {
    const current = await output.readMutation(operation);
    if (current?.phase !== "settled") {
      await output.completeMutation(operation);
    }
  }
  {
    const checkedResult: Awaited<Promise<A>> | Promise<A> = result;
    return checkedResult;
  }
};

export const makeAuthOutputFence = (output: PrivateOutputMutationPort) => {
  const checkedResult: AuthOutputFence = async (
    { accountId, intentKey, replayable, reconcileOnly },
    canonical
  ) => {
    const mutation = {
      intentKey,
      key: await privateOutputKey("account", accountId),
      scope: "account" as const,
    };
    if (replayable) {
      Object.assign(mutation, { replayable });
    }
    if (reconcileOnly) {
      Object.assign(mutation, { reconcileOnly });
    }
    return runOutputFencedMutation(output, mutation, canonical);
  };
  return checkedResult;
};
