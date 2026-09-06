import { HouseholdPeopleUnavailable } from "@meal-planner/household-api";
import { Context, Effect, Exit, Layer, Semaphore } from "effect";

import { privateOutputMutationPort } from "./private-output-binding.js";
import { privateOutputKey } from "./private-output.contract.js";

export class HouseholdOutputFence extends Context.Service<
  HouseholdOutputFence,
  {
    readonly run: <A, E, R>(
      input: {
        readonly intentKey: string;
        readonly organizationId: string;
        readonly wasCommitted: Effect.Effect<
          boolean,
          HouseholdPeopleUnavailable,
          R
        >;
      },
      canonical: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | HouseholdPeopleUnavailable, R>;
  }
>()("HouseholdOutputFence") {}

const unavailable = () => HouseholdPeopleUnavailable.make({});

export const HouseholdOutputFenceLive = Layer.effect(
  HouseholdOutputFence,
  Effect.gen(function* makeHouseholdOutputFence() {
    const output = yield* privateOutputMutationPort;
    // One HouseholdObject owns these commands; preserve its canonical stale-version/replay ordering across fence RPC.
    const writers = yield* Semaphore.make(1);
    return HouseholdOutputFence.of({
      run: (input, canonical) =>
        Effect.gen(function* run() {
          const key = yield* Effect.tryPromise({
            catch: unavailable,
            try: () => privateOutputKey("household", input.organizationId),
          });
          const scope = "household" as const;
          const retained = yield* Effect.tryPromise({
            catch: unavailable,
            try: () =>
              output.beginMutation({ intentKey: input.intentKey, key, scope }),
          });
          const operation = { key, operationId: retained.operationId, scope };
          if (retained.phase === "dispatched") {
            // An existing canonical receipt permits only repository replay; it still verifies the exact original intent.
            if (!(yield* input.wasCommitted)) {
              return yield* Effect.fail(unavailable());
            }
          } else {
            yield* Effect.tryPromise({
              catch: unavailable,
              try: () => output.prepareMutation(operation),
            });
            yield* Effect.tryPromise({
              catch: unavailable,
              try: () => output.markDispatched(operation),
            });
          }
          const result = yield* Effect.exit(canonical);
          yield* Effect.tryPromise({
            catch: unavailable,
            try: async () => {
              try {
                await output.completeMutation(operation);
              } catch {
                const completed = await output.readMutation(operation);
                if (completed?.phase !== "settled") {
                  await output.completeMutation(operation);
                }
              }
            },
          });
          return yield* Exit.match(result, {
            onFailure: Effect.failCause,
            onSuccess: Effect.succeed,
          });
        }).pipe(writers.withPermit),
    });
  })
);
