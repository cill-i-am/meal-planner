/* eslint-disable max-classes-per-file -- Native namespaces share one lifecycle implementation and export module. */
import type * as NativeCloudflare from "@cloudflare/workers-types";
import { Agent } from "agents";
import { and, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Schema } from "effect";

import migrations from "../../../private-output-migrations/migrations.js";
import {
  OutputMutation,
  OutputMutationIntent,
  OutputRegistration,
  PrivateOutputUnavailable,
} from "./private-output.contract.js";
import {
  outputMutations,
  outputRegistrations,
} from "./private-output.database-schema.js";

interface OutputLifecycleEnvironment extends Cloudflare.Env {
  readonly PrivateInterviewSession: {
    readonly getByName: (name: string) => {
      readonly invalidateOutput: (input: {
        readonly generation: string;
      }) => Promise<void>;
    };
  };
}

/** Serialize output registration with canonical writers, without owning authority. */
class OutputLifecycle extends Agent<OutputLifecycleEnvironment> {
  #database = drizzle(this.ctx.storage);

  constructor(
    context: NativeCloudflare.DurableObjectState,
    environment: OutputLifecycleEnvironment
  ) {
    // The Agent receives a runtime invalidation-only facade, never the child's broad namespace.
    super(context, {
      ...environment,
      PrivateInterviewSession: {
        getByName: (name: string) => ({
          invalidateOutput: (input: { readonly generation: string }) =>
            environment.PrivateInterviewSession.getByName(
              name
            ).invalidateOutput(input),
        }),
      },
    });
    // Native RPC enters directly; Agent onStart alone does not initialize this path.
    context.blockConcurrencyWhile(() => {
      migrate(this.#database, migrations);
      return Promise.resolve();
    });
  }

  // eslint-disable-next-line class-methods-use-this -- Required public Agent lifecycle hook.
  override onRequest() {
    return new Response(null, { status: 404 });
  }

  // eslint-disable-next-line class-methods-use-this -- Required public Agent protocol policy hook.
  override shouldConnectionBeReadonly() {
    return true;
  }

  // eslint-disable-next-line class-methods-use-this -- Required public Agent protocol policy hook.
  override shouldSendProtocolMessages() {
    return false;
  }

  register(untrusted: OutputRegistration): boolean {
    const input = Schema.decodeUnknownSync(OutputRegistration)(untrusted);
    return this.#database.transaction((transaction) => {
      const pending = transaction
        .select()
        .from(outputMutations)
        .where(ne(outputMutations.phase, "settled"))
        .get();
      if (pending !== undefined) {
        return false;
      }
      transaction
        .insert(outputRegistrations)
        .values(input)
        .onConflictDoNothing()
        .run();
      return true;
    });
  }

  beginMutation(untrusted: OutputMutationIntent) {
    const input = Schema.decodeUnknownSync(OutputMutationIntent)(untrusted);
    return this.#database.transaction((transaction) => {
      const pending = transaction
        .select()
        .from(outputMutations)
        .where(
          and(
            eq(outputMutations.intentKey, input.intentKey),
            ne(outputMutations.phase, "settled")
          )
        )
        .get();
      if (pending !== undefined) {
        return { operationId: pending.operationId, phase: pending.phase };
      }
      const operationId = crypto.randomUUID();
      transaction
        .insert(outputMutations)
        .values({ ...input, operationId, phase: "fencing" })
        .run();
      return { operationId, phase: "fencing" as const };
    });
  }

  /** Retrying this exact operation also retries lost child invalidation acknowledgments. */
  async prepareMutation(untrusted: OutputMutation): Promise<void> {
    const input = Schema.decodeUnknownSync(OutputMutation)(untrusted);
    this.#database.transaction((transaction) => {
      const retained = transaction
        .select()
        .from(outputMutations)
        .where(eq(outputMutations.operationId, input.operationId))
        .get();
      if (retained?.phase === "dispatched" || retained?.phase === "settled") {
        throw new PrivateOutputUnavailable({ reason: "operation_conflict" });
      }
      if (retained === undefined) {
        throw new PrivateOutputUnavailable({ reason: "operation_conflict" });
      }
    });

    const registrations = this.#database
      .select()
      .from(outputRegistrations)
      .all();
    await Promise.all(
      registrations.map((registration) =>
        this.env.PrivateInterviewSession.getByName(
          registration.childName
        ).invalidateOutput({ generation: registration.generation })
      )
    );
    this.#database
      .update(outputMutations)
      .set({ phase: "ready" })
      .where(
        and(
          eq(outputMutations.operationId, input.operationId),
          eq(outputMutations.phase, "fencing")
        )
      )
      .run();
  }

  markDispatched(untrusted: OutputMutation): void {
    const input = Schema.decodeUnknownSync(OutputMutation)(untrusted);
    const operation = this.#database
      .select()
      .from(outputMutations)
      .where(eq(outputMutations.operationId, input.operationId))
      .get();
    if (operation?.phase !== "ready") {
      throw new PrivateOutputUnavailable({ reason: "operation_conflict" });
    }
    this.#database
      .update(outputMutations)
      .set({ phase: "dispatched" })
      .where(eq(outputMutations.operationId, input.operationId))
      .run();
  }

  /** Settle only this definite outcome; any other pending operation keeps registration closed. */
  completeMutation(untrusted: OutputMutation): void {
    const input = Schema.decodeUnknownSync(OutputMutation)(untrusted);
    this.#database.transaction((transaction) => {
      const operation = transaction
        .select()
        .from(outputMutations)
        .where(eq(outputMutations.operationId, input.operationId))
        .get();
      if (operation?.phase === "settled") {
        return;
      }
      if (operation?.phase !== "dispatched" && operation?.phase !== "ready") {
        throw new PrivateOutputUnavailable({ reason: "operation_conflict" });
      }
      transaction.delete(outputRegistrations).run();
      transaction
        .update(outputMutations)
        .set({ phase: "settled" })
        .where(eq(outputMutations.operationId, input.operationId))
        .run();
    });
  }

  readMutation(untrusted: OutputMutation) {
    const input = Schema.decodeUnknownSync(OutputMutation)(untrusted);
    return (
      this.#database
        .select({ phase: outputMutations.phase })
        .from(outputMutations)
        .where(eq(outputMutations.operationId, input.operationId))
        .get() ?? null
    );
  }
}

export class AccountOutputLifecycle extends OutputLifecycle {}
export class HouseholdAgent extends OutputLifecycle {}
