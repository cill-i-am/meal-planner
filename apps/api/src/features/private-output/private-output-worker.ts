/* eslint-disable max-classes-per-file -- Named native entrypoints separate admission and mutation capabilities in one worker. */
import type * as NativeCloudflare from "@cloudflare/workers-types";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Schema } from "effect";

import {
  OutputMutation,
  OutputMutationIntent,
  PrivateSessionBinding,
  privateOutputKey,
} from "./private-output.contract.js";
import type { OutputLifecyclePort } from "./private-output.contract.js";

export { AccountOutputLifecycle, HouseholdAgent } from "./output-lifecycle.js";
export { PrivateInterviewSession } from "./private-interview-session.js";

declare const Response: typeof NativeCloudflare.Response;

export const OutputScope = Schema.Struct({
  key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))),
  scope: Schema.Literals(["account", "household"]),
});
const ScopedIntent = Schema.Struct({
  ...OutputScope.fields,
  ...OutputMutationIntent.fields,
});
const ScopedMutation = Schema.Struct({
  ...OutputScope.fields,
  ...OutputMutation.fields,
});
const Session = Schema.Struct({
  sessionReference: Schema.String.pipe(Schema.check(Schema.isUUID())),
});
const AuthorizedSession = Schema.Struct({
  binding: PrivateSessionBinding,
  expiresAt: Schema.Number,
  generation: Schema.String.pipe(Schema.check(Schema.isUUID())),
});

interface OutputWorkerEnvironment {
  readonly AccountOutputLifecycle: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
  readonly HouseholdAgent: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
  readonly PrivateInterviewSession: {
    readonly getByName: (name: string) => {
      readonly initialize: (input: PrivateSessionBinding) => Promise<void>;
      readonly beginConnection: (
        input: PrivateSessionBinding
      ) => Promise<string>;
      readonly authorizeConnection: (
        input: typeof AuthorizedSession.Type
      ) => Promise<void>;
      readonly fetch: (
        request: Request | NativeCloudflare.Request
      ) => Promise<NativeCloudflare.Response>;
    };
  };
}

/** Trusted service-binding entrypoint. No arbitrary method dispatch or private result values. */
export class PrivateOutputApi extends WorkerEntrypoint<OutputWorkerEnvironment> {
  async beginConnection(untrusted: PrivateSessionBinding) {
    const binding = Schema.decodeUnknownSync(PrivateSessionBinding)(untrusted);
    const child = this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", binding.sessionReference)
    );
    await child.initialize(binding);
    return child.beginConnection(binding);
  }

  async authorizeConnection(untrusted: typeof AuthorizedSession.Type) {
    const input = Schema.decodeUnknownSync(AuthorizedSession)(untrusted);
    await this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.binding.sessionReference)
    ).authorizeConnection(input);
  }

  override async fetch(
    request: Request | NativeCloudflare.Request
  ): Promise<NativeCloudflare.Response> {
    const url = new URL(request.url);
    if (
      url.origin !== "https://private-output.internal" ||
      url.pathname !== "/upgrade" ||
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    ) {
      return new Response(null, { status: 404 });
    }
    const session = Schema.decodeUnknownSync(Session)({
      sessionReference: request.headers.get("private-output-session"),
    });
    const child = this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", session.sessionReference)
    );
    return child.fetch(request);
  }
}

export class PrivateOutputMutations extends WorkerEntrypoint<OutputWorkerEnvironment> {
  #coordinator(input: typeof OutputScope.Type) {
    return input.scope === "account"
      ? this.env.AccountOutputLifecycle.getByName(input.key)
      : this.env.HouseholdAgent.getByName(input.key);
  }

  beginMutation(untrusted: typeof ScopedIntent.Type) {
    const input = Schema.decodeUnknownSync(ScopedIntent)(untrusted);
    return this.#coordinator(input).beginMutation({
      intentKey: input.intentKey,
    });
  }

  prepareMutation(untrusted: typeof ScopedMutation.Type) {
    const input = Schema.decodeUnknownSync(ScopedMutation)(untrusted);
    return this.#coordinator(input).prepareMutation({
      operationId: input.operationId,
    });
  }

  markDispatched(untrusted: typeof ScopedMutation.Type) {
    const input = Schema.decodeUnknownSync(ScopedMutation)(untrusted);
    return this.#coordinator(input).markDispatched({
      operationId: input.operationId,
    });
  }

  completeMutation(untrusted: typeof ScopedMutation.Type) {
    const input = Schema.decodeUnknownSync(ScopedMutation)(untrusted);
    return this.#coordinator(input).completeMutation({
      operationId: input.operationId,
    });
  }

  readMutation(untrusted: typeof ScopedMutation.Type) {
    const input = Schema.decodeUnknownSync(ScopedMutation)(untrusted);
    return this.#coordinator(input).readMutation({
      operationId: input.operationId,
    });
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
