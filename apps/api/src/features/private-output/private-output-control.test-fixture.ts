import type * as NativeCloudflare from "@cloudflare/workers-types";
import { Schema } from "effect";

import { PrivateInterviewSession as ProductionSession } from "./private-interview-session.js";
import {
  PrivateSessionBinding,
  privateOutputKey,
} from "./private-output.contract.js";
import type { OutputLifecyclePort } from "./private-output.contract.js";

export {
  AccountOutputLifecycle,
  HouseholdAgent,
  PrivateOutputApi,
  PrivateOutputMutations,
} from "./private-output-worker.js";

/** A durable test-only lost acknowledgement after the production invalidation has committed. */
export class PrivateInterviewSession extends ProductionSession {
  async loseNextInvalidationAcknowledgement() {
    await this.ctx.storage.put("lose-invalidation", true);
  }
  override async invalidateOutput(input: { readonly generation: string }) {
    super.invalidateOutput(input);
    if (await this.ctx.storage.get("lose-invalidation")) {
      await this.ctx.storage.delete("lose-invalidation");
      throw new Error("Synthetic lost invalidation acknowledgement");
    }
  }
}

type SessionPort = {
  [
    Key in
      | "initialize"
      | "beginConnection"
      | "authorizeConnection"
      | "invalidateOutput"
      | "enqueueOutput"
      | "readMetadata"
      | "readOutputLifecycle"
      | "completeSession"
      | "fetch"
  ]: (
    ...args: Parameters<PrivateInterviewSession[Key]>
  ) => Promise<Awaited<ReturnType<PrivateInterviewSession[Key]>>>;
} & {
  loseNextInvalidationAcknowledgement: () => Promise<void>;
  sql: (query: string) => Promise<unknown>;
  readonly state: Promise<unknown>;
  readonly ctx: {
    readonly storage: {
      readonly sql: { readonly exec: (query: string) => Promise<unknown> };
    };
  };
};
interface Environment {
  readonly PrivateInterviewSession: {
    readonly getByName: (name: string) => SessionPort;
  };
  readonly AccountOutputLifecycle: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
  readonly HouseholdAgent: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
}

const Command = Schema.Struct({
  action: Schema.String,
  binding: Schema.optional(PrivateSessionBinding),
  expiresAt: Schema.optional(Schema.Number),
  generation: Schema.optional(Schema.String),
  intentKey: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  operationId: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.Literals(["account", "household"])),
  sessionReference: Schema.String,
});

/** Test-only direct capabilities; this shell is never referenced by the production worker resource. */
export default {
  // eslint-disable-next-line complexity -- Test-only command router keeps the production capabilities directly observable.
  async fetch(
    request: Request,
    env: Environment
  ): Promise<Response | NativeCloudflare.Response> {
    const input = Schema.decodeUnknownSync(Command)(
      JSON.parse(request.headers.get("x-test-command") ?? "null")
    );
    const child = env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.sessionReference)
    );
    const generation = { generation: input.generation ?? "" };
    try {
      let result: unknown = null;
      if (input.action === "initialize" && input.binding) {
        result = await child.initialize(input.binding);
      } else if (input.action === "begin" && input.binding) {
        result = await child.beginConnection(input.binding);
      } else if (input.action === "authorize" && input.binding) {
        result = await child.authorizeConnection({
          ...generation,
          binding: input.binding,
          expiresAt: input.expiresAt ?? 0,
        });
      } else if (input.action === "connect") {
        return child.fetch(
          new Request(request.url, {
            headers: {
              Upgrade: "websocket",
              "private-output-generation": generation.generation,
            },
          })
        );
      } else if (input.action === "emit") {
        result = await child.enqueueOutput({
          ...generation,
          payload: input.payload ?? "",
        });
      } else if (input.action === "metadata") {
        result = await child.readMetadata();
      } else if (input.action === "lifecycle") {
        result = await child.readOutputLifecycle();
      } else if (input.action === "complete") {
        result = await child.completeSession(generation);
      } else if (input.action === "lose-ack") {
        result = await child.loseNextInvalidationAcknowledgement();
      } else if (input.action === "sql") {
        result = await child.sql("select * from private_session_binding");
      } else if (input.action === "state") {
        result = await child.state;
      } else if (input.action === "context-sql") {
        result = await child.ctx.storage.sql.exec(
          "select * from private_session_binding"
        );
      } else if (input.action === "private-http") {
        return child.fetch(new Request(request.url));
      } else if (input.key) {
        const coordinator = (
          input.scope === "household"
            ? env.HouseholdAgent
            : env.AccountOutputLifecycle
        ).getByName(input.key);
        const operation = { operationId: input.operationId ?? "" };
        if (input.action === "mutation-begin") {
          result = await coordinator.beginMutation({
            intentKey: input.intentKey ?? "",
          });
        } else if (input.action === "mutation-prepare") {
          result = await coordinator.prepareMutation(operation);
        } else if (input.action === "mutation-dispatch") {
          result = await coordinator.markDispatched(operation);
        } else if (input.action === "mutation-complete") {
          result = await coordinator.completeMutation(operation);
        } else if (input.action === "mutation-read") {
          result = await coordinator.readMutation(operation);
        } else {
          return new Response(null, { status: 404 });
        }
      } else {
        return new Response(null, { status: 404 });
      }
      return Response.json({ result: result ?? null });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Rejected" },
        { status: 409 }
      );
    }
  },
};
