/* eslint-disable max-classes-per-file -- Frozen pre-WI01 storage is seeded through disposable native fixture classes. */
import type * as NativeCloudflare from "@cloudflare/workers-types";
import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Schema } from "effect";

import migrations from "../../../private-output-migrations/migrations.js";
import {
  PrivateSessionBinding,
  privateOutputKey,
} from "./private-output.contract.js";

export {
  HouseholdAgent,
  PrivateInterviewDirectory,
  PrivateOutputApi,
  PrivateOutputMutations,
} from "./private-output-worker.js";

const Seed = Schema.Struct({
  binding: PrivateSessionBinding,
  generation: Schema.String,
  intentKey: Schema.String,
  operationId: Schema.String,
  phase: Schema.Literals(["fencing", "ready", "dispatched"]),
});
type Seed = typeof Seed.Type;
class BaselineObject extends DurableObject {
  constructor(
    context: NativeCloudflare.DurableObjectState,
    environment: Environment
  ) {
    super(context, environment);
    context.blockConcurrencyWhile(() => {
      migrate(drizzle(context.storage), {
        migrations: {
          "20260906070746_private_output_lifecycle": Schema.decodeUnknownSync(
            Schema.String
          )(migrations.migrations["20260906070746_private_output_lifecycle"]),
        },
      });
      return Promise.resolve();
    });
  }
}
export class AccountOutputLifecycle extends BaselineObject {
  seed(input: Seed & { readonly childName: string }) {
    this.ctx.storage.sql.exec(
      "INSERT INTO output_registrations (child_name, generation) VALUES (?, ?)",
      input.childName,
      input.generation
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO output_mutations (intent_key, operation_id, phase) VALUES (?, ?, ?)",
      input.intentKey,
      input.operationId,
      input.phase
    );
  }
}
export class PrivateInterviewSession extends BaselineObject {
  seed(input: Seed) {
    const { binding } = input;
    this.ctx.storage.sql.exec(
      "INSERT INTO private_session_binding (account_key, household_key, linkage_subject, person_id, session_reference, status) VALUES (?, ?, ?, ?, ?, 'open')",
      binding.accountKey,
      binding.householdKey,
      binding.linkageSubject,
      binding.personId,
      binding.sessionReference
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO private_output_generation (expires_at, generation, singleton, status) VALUES (?, ?, 1, 'connected')",
      Date.now() + 60_000,
      input.generation
    );
  }
}
interface Environment {
  readonly AccountOutputLifecycle: {
    readonly getByName: (name: string) => {
      readonly seed: (
        input: Seed & { readonly childName: string }
      ) => Promise<void>;
    };
  };
  readonly PrivateInterviewSession: {
    readonly getByName: (name: string) => {
      readonly seed: (input: Seed) => Promise<void>;
    };
  };
}
export default {
  async fetch(request: Request, environment: Environment) {
    const input = Schema.decodeUnknownSync(Seed)(
      JSON.parse(request.headers.get("x-test-command") ?? "null")
    );
    const childName = await privateOutputKey(
      "session",
      input.binding.sessionReference
    );
    await environment.PrivateInterviewSession.getByName(childName).seed(input);
    await environment.AccountOutputLifecycle.getByName(
      input.binding.accountKey
    ).seed({ ...input, childName });
    return Response.json({ result: null });
  },
};
