/* eslint-disable max-classes-per-file -- Named native entrypoints separate admission and mutation capabilities in one worker. */
import type * as NativeCloudflare from "@cloudflare/workers-types";
import type {
  AssistantTurn,
  DirectoryFrame,
  PrivateRequestSessionSnapshot,
  Reservation,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Schema } from "effect";

import {
  ReleaseConfirmation,
  SettleConfirmation,
} from "./private-confirmation.contract.js";
import type { ReleasedConfirmation } from "./private-confirmation.contract.js";
import {
  OutputMutation,
  OutputMutationIntent,
  PrivateSessionBinding,
  PrivateParticipantBinding,
  PrivateOutputUnavailable,
  privateDirectoryKey,
  privateOutputKey,
} from "./private-output.contract.js";
import type {
  OutputLifecyclePort,
  InitializePrivateSession,
} from "./private-output.contract.js";
import {
  PrivateDirectoryRequest,
  PrivateRequestCancel,
  PrivateRequestTurn,
  PrivateSessionRead,
  PrivateSessionRequest,
} from "./private-request.contract.js";

export { AccountOutputLifecycle, HouseholdAgent } from "./output-lifecycle.js";
export { PrivateInterviewDirectory } from "./private-interview-directory.js";
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
const AuthorizedDirectory = Schema.Struct({
  binding: PrivateParticipantBinding,
  expiresAt: Schema.Number,
  generation: Schema.String.pipe(Schema.check(Schema.isUUID())),
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
  readonly PrivateInterviewDirectory: {
    readonly getByName: (name: string) => {
      readonly initialize: (input: PrivateParticipantBinding) => Promise<void>;
      readonly beginConnection: (
        input: PrivateParticipantBinding
      ) => Promise<string>;
      readonly authorizeConnection: (
        input: typeof AuthorizedDirectory.Type
      ) => Promise<void>;
      readonly beginRequest: (
        input: PrivateParticipantBinding
      ) => Promise<string>;
      readonly authorizeRequest: (
        input: typeof AuthorizedDirectory.Type
      ) => Promise<void>;
      readonly executeDirectory: (
        input: typeof PrivateDirectoryRequest.Type
      ) => Promise<DirectoryFrame>;
      readonly readReservation: (
        input: PrivateSessionBinding
      ) => Promise<typeof Reservation.Type | null>;
      readonly fetch: (
        request: Request | NativeCloudflare.Request
      ) => Promise<NativeCloudflare.Response>;
    };
  };
  readonly PrivateInterviewSession: {
    readonly getByName: (name: string) => {
      readonly initialize: (
        input: typeof InitializePrivateSession.Type
      ) => Promise<void>;
      readonly beginConnection: (
        input: PrivateSessionBinding
      ) => Promise<string>;
      readonly authorizeConnection: (
        input: typeof AuthorizedSession.Type
      ) => Promise<void>;
      readonly beginRequest: (input: PrivateSessionBinding) => Promise<string>;
      readonly authorizeRequest: (
        input: typeof AuthorizedSession.Type
      ) => Promise<void>;
      readonly executeSession: (
        input: typeof PrivateSessionRequest.Type
      ) => Promise<SessionFrame>;
      readonly readSession: (
        input: typeof PrivateSessionRead.Type
      ) => Promise<PrivateRequestSessionSnapshot>;
      readonly startTurn: (
        input: typeof PrivateRequestTurn.Type
      ) => Promise<AssistantTurn>;
      readonly cancelTurn: (
        input: typeof PrivateRequestCancel.Type
      ) => Promise<AssistantTurn>;
      readonly releaseConfirmation: (
        input: typeof ReleaseConfirmation.Type
      ) => Promise<ReleasedConfirmation>;
      readonly settleConfirmation: (
        input: typeof SettleConfirmation.Type
      ) => Promise<void>;
      readonly fetch: (
        request: Request | NativeCloudflare.Request
      ) => Promise<NativeCloudflare.Response>;
    };
  };
}

/** Trusted service-binding entrypoint for admission, model turns, and confirmed commands. */
export class PrivateOutputApi extends WorkerEntrypoint<OutputWorkerEnvironment> {
  async beginDirectoryConnection(untrusted: PrivateParticipantBinding) {
    const binding = Schema.decodeUnknownSync(PrivateParticipantBinding, {
      onExcessProperty: "error",
    })(untrusted);
    const child = this.env.PrivateInterviewDirectory.getByName(
      await privateDirectoryKey(binding)
    );
    await child.initialize(binding);
    return child.beginConnection(binding);
  }
  async beginDirectoryRequest(untrusted: PrivateParticipantBinding) {
    const binding = Schema.decodeUnknownSync(PrivateParticipantBinding, {
      onExcessProperty: "error",
    })(untrusted);
    const child = this.env.PrivateInterviewDirectory.getByName(
      await privateDirectoryKey(binding)
    );
    await child.initialize(binding);
    return child.beginRequest(binding);
  }
  async authorizeDirectoryRequest(untrusted: typeof AuthorizedDirectory.Type) {
    const input = Schema.decodeUnknownSync(AuthorizedDirectory, {
      onExcessProperty: "error",
    })(untrusted);
    return this.env.PrivateInterviewDirectory.getByName(
      await privateDirectoryKey(input.binding)
    ).authorizeRequest(input);
  }
  async executeDirectory(untrusted: typeof PrivateDirectoryRequest.Type) {
    const input = Schema.decodeUnknownSync(PrivateDirectoryRequest, {
      onExcessProperty: "error",
    })(untrusted);
    return this.env.PrivateInterviewDirectory.getByName(
      await privateDirectoryKey(input.binding)
    ).executeDirectory(input);
  }
  async authorizeDirectoryConnection(
    untrusted: typeof AuthorizedDirectory.Type
  ) {
    const input = Schema.decodeUnknownSync(AuthorizedDirectory, {
      onExcessProperty: "error",
    })(untrusted);
    await this.env.PrivateInterviewDirectory.getByName(
      await privateDirectoryKey(input.binding)
    ).authorizeConnection(input);
  }
  async beginConnection(untrusted: PrivateSessionBinding) {
    const binding = Schema.decodeUnknownSync(PrivateSessionBinding, {
      onExcessProperty: "error",
    })(untrusted);
    const child = await this.#initializeSession(binding);
    return child.beginConnection(binding);
  }
  async beginRequest(untrusted: PrivateSessionBinding) {
    const binding = Schema.decodeUnknownSync(PrivateSessionBinding, {
      onExcessProperty: "error",
    })(untrusted);
    const child = await this.#initializeSession(binding);
    return child.beginRequest(binding);
  }
  async #initializeSession(binding: PrivateSessionBinding) {
    const reservation = await this.env.PrivateInterviewDirectory.getByName(
      await privateDirectoryKey(binding)
    ).readReservation(binding);
    if (reservation === null) {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    const child = this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", binding.sessionReference)
    );
    await child.initialize({ binding, scope: reservation.scope });
    return child;
  }

  async authorizeConnection(untrusted: typeof AuthorizedSession.Type) {
    const input = Schema.decodeUnknownSync(AuthorizedSession)(untrusted);
    await this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.binding.sessionReference)
    ).authorizeConnection(input);
  }

  async authorizeRequest(untrusted: typeof AuthorizedSession.Type) {
    const input = Schema.decodeUnknownSync(AuthorizedSession, {
      onExcessProperty: "error",
    })(untrusted);
    return this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.binding.sessionReference)
    ).authorizeRequest(input);
  }
  async executeSession(untrusted: typeof PrivateSessionRequest.Type) {
    const input = Schema.decodeUnknownSync(PrivateSessionRequest, {
      onExcessProperty: "error",
    })(untrusted);
    return this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.binding.sessionReference)
    ).executeSession(input);
  }
  async readSession(untrusted: typeof PrivateSessionRead.Type) {
    const input = Schema.decodeUnknownSync(PrivateSessionRead, {
      onExcessProperty: "error",
    })(untrusted);
    return this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.binding.sessionReference)
    ).readSession(input);
  }
  async startTurn(untrusted: typeof PrivateRequestTurn.Type) {
    const input = Schema.decodeUnknownSync(PrivateRequestTurn, {
      onExcessProperty: "error",
    })(untrusted);
    return this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.binding.sessionReference)
    ).startTurn(input);
  }
  async cancelTurn(untrusted: typeof PrivateRequestCancel.Type) {
    const input = Schema.decodeUnknownSync(PrivateRequestCancel, {
      onExcessProperty: "error",
    })(untrusted);
    return this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.binding.sessionReference)
    ).cancelTurn(input);
  }
  async releaseConfirmation(untrusted: typeof ReleaseConfirmation.Type) {
    const input = Schema.decodeUnknownSync(ReleaseConfirmation, {
      onExcessProperty: "error",
    })(untrusted);
    return this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.binding.sessionReference)
    ).releaseConfirmation(input);
  }
  async settleConfirmation(untrusted: typeof SettleConfirmation.Type) {
    const input = Schema.decodeUnknownSync(SettleConfirmation, {
      onExcessProperty: "error",
    })(untrusted);
    return this.env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.binding.sessionReference)
    ).settleConfirmation(input);
  }
  override async fetch(
    request: Request | NativeCloudflare.Request
  ): Promise<NativeCloudflare.Response> {
    const url = new URL(request.url);
    if (
      url.origin === "https://private-output.internal" &&
      url.pathname === "/chat" &&
      ["GET", "POST", "DELETE"].includes(request.method) &&
      !request.headers.has("private-output-directory")
    ) {
      const session = Schema.decodeUnknownSync(Session)({
        sessionReference: request.headers.get("private-output-session"),
      });
      return this.env.PrivateInterviewSession.getByName(
        await privateOutputKey("session", session.sessionReference)
      ).fetch(request);
    }
    if (
      url.origin !== "https://private-output.internal" ||
      url.pathname !== "/upgrade" ||
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    ) {
      return new Response(null, { status: 404 });
    }
    const directoryKey = request.headers.get("private-output-directory");
    if (directoryKey !== null) {
      const key = Schema.decodeUnknownSync(OutputScope.fields.key)(
        directoryKey
      );
      if (request.headers.has("private-output-session")) {
        return new Response(null, { status: 404 });
      }
      return this.env.PrivateInterviewDirectory.getByName(key).fetch(request);
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

  findPendingMutation(untrusted: typeof ScopedIntent.Type) {
    const input = Schema.decodeUnknownSync(ScopedIntent)(untrusted);
    return this.#coordinator(input).findPendingMutation({
      intentKey: input.intentKey,
    });
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
