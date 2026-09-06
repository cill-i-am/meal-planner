import type { AuthOutputFence } from "../auth/auth-output-fence.js";
import type { PrivateOutputMutationPort } from "./private-output-binding.js";
import {
  privateOutputKey,
  PrivateOutputUnavailable,
} from "./private-output.contract.js";

/** A definite result reopens registration; an ambiguous canonical write stays fenced durably. */
export const runOutputFencedMutation = async <A>(
  output: PrivateOutputMutationPort,
  input: {
    readonly scope: "account" | "household";
    readonly key: string;
    readonly intentKey: string;
  },
  canonical: () => Promise<A>
): Promise<A> => {
  const retained = await output.beginMutation(input);
  if (retained.phase === "dispatched") {
    throw new PrivateOutputUnavailable({ reason: "mutation_pending" });
  }
  const operation = {
    key: input.key,
    operationId: retained.operationId,
    scope: input.scope,
  };
  await output.prepareMutation(operation);
  await output.markDispatched(operation);
  const result = await canonical();
  try {
    await output.completeMutation(operation);
  } catch {
    // A lost completion acknowledgement is recoverable from the exact durable operation.
    const current = await output.readMutation(operation);
    if (current?.phase !== "settled") {
      await output.completeMutation(operation);
    }
  }
  return result;
};

export const makeAuthOutputFence =
  (output: PrivateOutputMutationPort): AuthOutputFence =>
  async ({ accountId, intentKey }, canonical) =>
    runOutputFencedMutation(
      output,
      {
        intentKey,
        key: await privateOutputKey("account", accountId),
        scope: "account",
      },
      canonical
    );
