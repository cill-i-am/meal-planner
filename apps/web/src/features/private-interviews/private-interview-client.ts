import type { PersonProfile } from "@meal-planner/household-api";
import {
  AppendParticipantMessage,
  CompleteSession,
  ConfirmProfileCard,
  RejectProfileCard,
  ReviseProfileCard,
  DirectoryFrame,
  MAX_PAGE_SIZE,
  MAX_PRIVATE_FRAME_BYTES,
  SessionFrame,
  StartSession,
} from "@meal-planner/private-interview-api";
import type {
  DirectoryCommand,
  Message,
  ProfileCard,
  ProfileCardChange,
  Rejected,
  Reservation,
  SessionCommand,
  SessionState,
} from "@meal-planner/private-interview-api";
import { Schema } from "effect";

import { ProfileOperationError } from "../household-profiles/operations.js";
import {
  readCurrentPrivateProfile,
  continuePrivateConfirmation,
} from "./private-profile-browser.js";
import { matchesCurrentProfileReview } from "./private-profile-review.js";

const SessionMutation = Schema.Union([
  AppendParticipantMessage,
  CompleteSession,
  ReviseProfileCard,
  RejectProfileCard,
  ConfirmProfileCard,
]);
type SessionMutation = typeof SessionMutation.Type;

const PendingCommand = Schema.Union([
  Schema.Struct({
    bindingKey: Schema.String,
    command: StartSession,
    sessionReference: Schema.Null,
  }),
  Schema.Struct({
    bindingKey: Schema.String,
    command: SessionMutation,
    sessionReference: Schema.String,
  }),
]);
type PendingCommand = typeof PendingCommand.Type;
type Connection =
  | "connecting"
  | "ready"
  | "unavailable"
  | "authentication_required";
type Notice =
  | "storage_unavailable"
  | "binding_changed"
  | typeof Rejected.Type.reason
  | null;

export interface PrivateInterviewView {
  readonly connection: Connection;
  readonly cards: readonly ProfileCard[];
  readonly cardsLoaded: boolean;
  readonly moreCards: boolean;
  readonly profile: PersonProfile | null;
  readonly profileLoading: boolean;
  readonly profileUnavailable: boolean;
  readonly pendingConfirmation: string | null;
  readonly confirmationStatus:
    | "idle"
    | "sending"
    | "waiting"
    | "retry_required";
  readonly reservations: readonly (typeof Reservation.Type)[];
  readonly sessionsLoaded: boolean;
  readonly moreSessions: boolean;
  readonly sessionReference: string | null;
  readonly sessionState: typeof SessionState.Type | null;
  readonly messages: readonly (typeof Message.Type)[];
  readonly historyLoaded: boolean;
  readonly moreHistory: boolean;
  readonly pending: PendingCommand | null;
  readonly notice: Notice;
  readonly lastAppendReceipt: string | null;
}

export interface PrivateInterviewSocket {
  onFrame: ((event: { readonly data: unknown }) => void) | null;
  onDisconnect: ((event: { readonly code: number }) => void) | null;
  onFailure: (() => void) | null;
  close: () => void;
  send: (data: string) => void;
}

export interface PrivateInterviewDependencies {
  readonly connect: (path: string) => PrivateInterviewSocket;
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly makeId: () => string;
  readonly readCurrentProfile: () => Promise<PersonProfile>;
  readonly continueConfirmation: (
    sessionReference: string,
    mutationId: string,
    generation: string,
    signal: AbortSignal
  ) => Promise<"accepted" | "authentication_required" | "unavailable">;
}

const initialView = (): PrivateInterviewView => ({
  cards: [],
  cardsLoaded: false,
  confirmationStatus: "idle",
  connection: "connecting",
  historyLoaded: false,
  lastAppendReceipt: null,
  messages: [],
  moreCards: false,
  moreHistory: false,
  moreSessions: false,
  notice: null,
  pending: null,
  pendingConfirmation: null,
  profile: null,
  profileLoading: false,
  profileUnavailable: false,
  reservations: [],
  sessionReference: null,
  sessionState: null,
  sessionsLoaded: false,
});

const mergeById = <T extends { readonly ordinal: number }>(
  current: readonly T[],
  incoming: readonly T[],
  key: (value: T) => string
): readonly T[] =>
  [
    ...new Map(
      [...current, ...incoming].map((value) => [key(value), value])
    ).values(),
  ].toSorted((left, right) => left.ordinal - right.ordinal);

const decodeFrame = <A>(
  schema: Schema.ConstraintDecoder<A, never>,
  data: string
): A => {
  if (new TextEncoder().encode(data).byteLength > MAX_PRIVATE_FRAME_BYTES) {
    throw new Error("Invalid private frame");
  }
  return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(
    JSON.parse(data)
  );
};

/** A mounted authenticated context owns its sockets and all rendered private data. */
export class PrivateInterviewClient {
  readonly #dependencies: PrivateInterviewDependencies;
  readonly #onConfirmationSettled: (() => void) | undefined;
  readonly #storageKey: string;
  readonly #listeners = new Set<() => void>();
  #view = initialView();
  #directory: PrivateInterviewSocket | null = null;
  #session: PrivateInterviewSocket | null = null;
  #bindingKey: string | null = null;
  #directoryReady = false;
  #sessionReady = false;
  #listRequest: string | null = null;
  #historyRequest: string | null = null;
  #listCursor = 0;
  #historyCursor = 0;
  #cardsRequest: string | null = null;
  #cardsCursor = 0;
  #confirmationAbort: AbortController | null = null;
  #sessionGeneration: string | null = null;

  constructor(
    context: { readonly accountId: string; readonly householdId: string },
    dependencies: PrivateInterviewDependencies,
    onConfirmationSettled?: () => void
  ) {
    this.#dependencies = dependencies;
    this.#onConfirmationSettled = onConfirmationSettled;
    this.#storageKey = `meal-planner.private-interview.pending.v1:${JSON.stringify([context.accountId, context.householdId])}`;
  }

  getSnapshot = (): PrivateInterviewView => this.#view;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #update(patch: Partial<PrivateInterviewView>) {
    this.#view = { ...this.#view, ...patch };
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #closeSockets() {
    const sockets = [this.#directory, this.#session];
    this.#directory = null;
    this.#session = null;
    this.#directoryReady = false;
    this.#sessionReady = false;
    this.#sessionGeneration = null;
    this.#bindingKey = null;
    this.#listRequest = null;
    this.#historyRequest = null;
    this.#cardsRequest = null;
    this.#confirmationAbort?.abort();
    this.#confirmationAbort = null;
    for (const socket of sockets) {
      socket?.close();
    }
  }

  disconnect = () => {
    this.#closeSockets();
    this.#update({ ...initialView(), connection: "unavailable" });
  };

  #lost(code: number) {
    this.#closeSockets();
    this.#update({
      ...initialView(),
      connection: code === 1008 ? "authentication_required" : "unavailable",
    });
  }

  #send(
    socket: PrivateInterviewSocket | null,
    command: DirectoryCommand | SessionCommand
  ) {
    if (socket === null) {
      return;
    }
    try {
      socket.send(JSON.stringify(command));
    } catch {
      this.#lost(1006);
    }
  }

  connect = () => {
    this.#closeSockets();
    this.#update(initialView());
    this.#listCursor = 0;
    try {
      const socket = this.#dependencies.connect(
        "/v1/private-interviews/directory/connect"
      );
      this.#directory = socket;
      socket.onFrame = (event) => {
        if (this.#directory !== socket) {
          return;
        }
        try {
          this.#onDirectory(
            decodeFrame(
              DirectoryFrame,
              Schema.decodeUnknownSync(Schema.String)(event.data)
            )
          );
        } catch {
          this.#lost(1006);
        }
      };
      socket.onDisconnect = (event) => {
        if (this.#directory === socket) {
          this.#lost(event.code);
        }
      };
      socket.onFailure = () => {
        if (this.#directory === socket) {
          this.#lost(1006);
        }
      };
    } catch {
      this.#lost(1006);
    }
  };

  #loadPending(bindingKey: string) {
    try {
      const raw = this.#dependencies.storage.getItem(this.#storageKey);
      if (raw === null) {
        return;
      }
      const pending = decodeFrame(PendingCommand, raw);
      if (pending.bindingKey !== bindingKey) {
        this.#update({ notice: "binding_changed" });
        return;
      }
      this.#update({ pending });
      if (pending.sessionReference !== null) {
        this.select(pending.sessionReference);
      }
    } catch {
      this.#update({ notice: "storage_unavailable" });
    }
  }

  #retain(pending: PendingCommand): boolean {
    try {
      this.#dependencies.storage.setItem(
        this.#storageKey,
        JSON.stringify(pending)
      );
      this.#update({ pending });
      return true;
    } catch {
      this.#update({ notice: "storage_unavailable" });
      return false;
    }
  }

  discardPreviousRequest = () => {
    if (this.#view.notice !== "binding_changed" || this.#bindingKey === null) {
      return;
    }
    try {
      const raw = this.#dependencies.storage.getItem(this.#storageKey);
      if (
        raw !== null &&
        decodeFrame(PendingCommand, raw).bindingKey !== this.#bindingKey
      ) {
        this.#dependencies.storage.removeItem(this.#storageKey);
      }
      this.#update({ notice: null });
    } catch {
      this.#update({ notice: "storage_unavailable" });
    }
  };

  #acknowledge(mutationId: string): PendingCommand | null {
    const { pending } = this.#view;
    if (pending?.command.mutationId !== mutationId) {
      return null;
    }
    try {
      // A stale mount may never clear a newer retained intent.
      const raw = this.#dependencies.storage.getItem(this.#storageKey);
      if (
        raw !== null &&
        decodeFrame(PendingCommand, raw).command.mutationId === mutationId
      ) {
        this.#dependencies.storage.removeItem(this.#storageKey);
      }
      this.#update({ pending: null });
      return pending;
    } catch {
      this.#update({ notice: "storage_unavailable" });
      return null;
    }
  }

  #onDirectory(frame: DirectoryFrame) {
    if (frame.type === "DirectoryReady") {
      if (this.#directoryReady) {
        throw new Error("Duplicate directory activation");
      }
      this.#bindingKey = frame.bindingKey;
      this.#directoryReady = true;
      this.#update({ connection: "ready" });
      this.#loadPending(frame.bindingKey);
      this.loadSessions();
      return;
    }
    if (!this.#directoryReady) {
      throw new Error("Directory not ready");
    }
    switch (frame.type) {
      case "SessionsListed": {
        if (frame.requestId !== this.#listRequest) {
          return;
        }
        if (frame.reservations.length > MAX_PAGE_SIZE) {
          throw new Error("Page too large");
        }
        this.#listRequest = null;
        this.#listCursor =
          frame.reservations.at(-1)?.ordinal ?? this.#listCursor;
        this.#update({
          moreSessions: frame.hasMore,
          reservations: mergeById(
            this.#view.reservations,
            frame.reservations,
            (item) => item.sessionReference
          ),
          sessionsLoaded: true,
        });
        return;
      }
      case "SessionStarted": {
        if (
          this.#view.pending?.command.type !== "StartSession" ||
          this.#acknowledge(frame.mutationId) === null
        ) {
          return;
        }
        this.#update({
          reservations: mergeById(
            this.#view.reservations,
            [frame.reservation],
            (item) => item.sessionReference
          ),
        });
        this.select(frame.reservation.sessionReference);
        return;
      }
      case "Rejected": {
        if (
          this.#view.pending?.command.type === "StartSession" &&
          this.#acknowledge(frame.commandId) !== null
        ) {
          this.#update({ notice: frame.reason });
        }
        return;
      }
      default: {
        throw new Error("Unexpected directory frame");
      }
    }
  }

  loadSessions = () => {
    if (!this.#directoryReady || this.#listRequest !== null) {
      return;
    }
    this.#listRequest = this.#dependencies.makeId();
    this.#send(this.#directory, {
      afterOrdinal: this.#listCursor,
      limit: MAX_PAGE_SIZE,
      requestId: this.#listRequest,
      type: "ListSessions",
    });
  };

  start = () => {
    if (
      !this.#directoryReady ||
      this.#bindingKey === null ||
      this.#view.pending !== null ||
      this.#view.pendingConfirmation !== null ||
      this.#view.notice === "binding_changed" ||
      this.#view.notice === "storage_unavailable"
    ) {
      return;
    }
    this.#update({ notice: null });
    const pending = {
      bindingKey: this.#bindingKey,
      command: {
        mutationId: this.#dependencies.makeId(),
        type: "StartSession" as const,
      },
      sessionReference: null,
    };
    if (this.#retain(pending)) {
      this.#send(this.#directory, pending.command);
    }
  };

  select = (sessionReference: string) => {
    if (
      !this.#directoryReady ||
      (this.#view.pendingConfirmation !== null &&
        this.#view.sessionReference !== sessionReference) ||
      (this.#view.pending !== null &&
        this.#view.pending.sessionReference !== sessionReference)
    ) {
      return;
    }
    const previous = this.#session;
    this.#session = null;
    previous?.close();
    this.#sessionReady = false;
    this.#sessionGeneration = null;
    this.#historyCursor = 0;
    this.#historyRequest = null;
    this.#cardsCursor = 0;
    this.#cardsRequest = null;
    this.#confirmationAbort?.abort();
    this.#confirmationAbort = null;
    this.#update({
      cards: [],
      cardsLoaded: false,
      confirmationStatus: "idle",
      historyLoaded: false,
      lastAppendReceipt: null,
      messages: [],
      moreCards: false,
      moreHistory: false,
      pendingConfirmation: null,
      profile: null,
      profileLoading: false,
      profileUnavailable: false,
      sessionReference,
      sessionState: null,
    });
    try {
      const socket = this.#dependencies.connect(
        `/v1/private-interviews/${encodeURIComponent(sessionReference)}/connect`
      );
      this.#session = socket;
      socket.onFrame = (event) => {
        if (this.#session !== socket) {
          return;
        }
        try {
          this.#onSession(
            decodeFrame(
              SessionFrame,
              Schema.decodeUnknownSync(Schema.String)(event.data)
            )
          );
        } catch {
          this.#lost(1006);
        }
      };
      socket.onDisconnect = (event) => {
        if (this.#session === socket) {
          this.#lost(event.code);
        }
      };
      socket.onFailure = () => {
        if (this.#session === socket) {
          this.#lost(1006);
        }
      };
    } catch {
      this.#lost(1006);
    }
  };

  #state(state: typeof SessionState.Type) {
    if (state.version >= (this.#view.sessionState?.version ?? 0)) {
      this.#update({ sessionState: state });
    }
  }

  #activateSession(frame: Extract<SessionFrame, { type: "SessionReady" }>) {
    if (
      this.#sessionReady ||
      frame.bindingKey !== this.#bindingKey ||
      frame.sessionReference !== this.#view.sessionReference
    ) {
      throw new Error("Session binding mismatch");
    }
    this.#sessionReady = true;
    this.#sessionGeneration = frame.generation;
    this.#state(frame.state);
    this.#update({ pendingConfirmation: frame.pendingConfirmation });
    this.loadHistory();
    this.loadCards();
  }

  #readHistory(frame: Extract<SessionFrame, { type: "HistoryRead" }>) {
    if (frame.requestId !== this.#historyRequest) {
      return;
    }
    if (frame.messages.length > MAX_PAGE_SIZE) {
      throw new Error("Page too large");
    }
    this.#historyRequest = null;
    this.#historyCursor = frame.messages.at(-1)?.ordinal ?? this.#historyCursor;
    this.#state(frame.state);
    this.#update({
      historyLoaded: true,
      messages: mergeById(
        this.#view.messages,
        frame.messages,
        (item) => item.id
      ),
      moreHistory: frame.hasMore,
    });
  }

  #onSession(frame: SessionFrame) {
    if (frame.type === "SessionReady") {
      this.#activateSession(frame);
      return;
    }
    if (!this.#sessionReady) {
      throw new Error("Session not ready");
    }
    switch (frame.type) {
      case "CardsRead": {
        this.#readCards(frame);
        return;
      }
      case "CardUpdated": {
        this.#cardUpdated(frame);
        return;
      }
      case "ConfirmationPending": {
        this.#confirmationPending(frame);
        return;
      }
      case "ConfirmationSettled": {
        this.#confirmationSettled(frame);
        return;
      }
      case "HistoryRead": {
        this.#readHistory(frame);
        return;
      }
      case "MessageAppended": {
        if (
          this.#view.pending?.command.type !== "AppendParticipantMessage" ||
          this.#acknowledge(frame.mutationId) === null
        ) {
          return;
        }
        this.#state(frame.state);
        this.#update({
          lastAppendReceipt: frame.mutationId,
          messages: mergeById(
            this.#view.messages,
            [frame.message],
            (item) => item.id
          ),
        });
        return;
      }
      case "SessionCompleted": {
        if (
          this.#view.pending?.command.type !== "CompleteSession" ||
          this.#acknowledge(frame.mutationId) === null
        ) {
          return;
        }
        this.#state(frame.state);
        return;
      }
      case "Rejected": {
        this.#sessionRejected(frame);
        return;
      }
      default: {
        throw new Error("Unexpected session frame");
      }
    }
  }

  #sessionRejected(frame: Extract<SessionFrame, { type: "Rejected" }>) {
    if (
      this.#view.pending?.sessionReference !== this.#view.sessionReference ||
      this.#acknowledge(frame.commandId) === null
    ) {
      return;
    }
    if (frame.state !== null) {
      this.#state(frame.state);
    }
    this.#update({ notice: frame.reason });
    if (frame.reason === "confirmation_pending") {
      this.loadCards();
    }
  }

  #mergeCards(cards: readonly ProfileCard[], currentVersion: boolean) {
    const previous = new Map(this.#view.cards.map((card) => [card.id, card]));
    for (const card of cards) {
      const existing = previous.get(card.id);
      if (
        existing === undefined ||
        card.revision > existing.revision ||
        (card.revision === existing.revision && currentVersion)
      ) {
        previous.set(card.id, card);
      }
    }
    this.#update({
      cards: [...previous.values()].toSorted((a, b) => a.ordinal - b.ordinal),
    });
  }

  #readCards(frame: Extract<SessionFrame, { type: "CardsRead" }>) {
    if (frame.requestId !== this.#cardsRequest) {
      return;
    }
    if (frame.cards.length > MAX_PAGE_SIZE) {
      throw new Error("Page too large");
    }
    this.#cardsRequest = null;
    this.#cardsCursor = frame.cards.at(-1)?.ordinal ?? this.#cardsCursor;
    const currentVersion =
      frame.state.version >= (this.#view.sessionState?.version ?? 0);
    this.#mergeCards(frame.cards, currentVersion);
    this.#state(frame.state);
    this.#update({ cardsLoaded: true, moreCards: frame.hasMore });
    if (currentVersion) {
      this.#update({ pendingConfirmation: frame.pendingConfirmation });
    }
    if (
      this.#view.cards.length > 0 &&
      this.#view.profile === null &&
      !this.#view.profileLoading
    ) {
      void this.refreshProfile();
    }
  }

  #cardUpdated(frame: Extract<SessionFrame, { type: "CardUpdated" }>) {
    if (this.#acknowledge(frame.mutationId) === null) {
      return;
    }
    this.#mergeCards(
      [frame.card],
      frame.state.version >= (this.#view.sessionState?.version ?? 0)
    );
    this.#state(frame.state);
  }

  #confirmationPending(
    frame: Extract<SessionFrame, { type: "ConfirmationPending" }>
  ) {
    if (frame.state.version < (this.#view.sessionState?.version ?? 0)) {
      return;
    }
    this.#mergeCards([frame.card], true);
    this.#state(frame.state);
    this.#update({ pendingConfirmation: frame.mutationId });
    if (
      this.#view.confirmationStatus === "idle" &&
      this.#view.pending?.command.type === "ConfirmProfileCard" &&
      this.#view.pending.command.mutationId === frame.mutationId
    ) {
      void this.checkConfirmation();
    }
  }

  #confirmationSettled(
    frame: Extract<SessionFrame, { type: "ConfirmationSettled" }>
  ) {
    const currentVersion =
      frame.state.version >= (this.#view.sessionState?.version ?? 0);
    this.#mergeCards([frame.card], currentVersion);
    this.#state(frame.state);
    this.#acknowledge(frame.mutationId);
    if (this.#view.pendingConfirmation === frame.mutationId) {
      this.#confirmationAbort?.abort();
      this.#confirmationAbort = null;
      this.#update({
        confirmationStatus: "idle",
        notice: null,
        pendingConfirmation: null,
      });
    }
    if (currentVersion) {
      this.#onConfirmationSettled?.();
      void this.refreshProfile();
    }
  }

  loadCards = () => {
    if (!this.#sessionReady || this.#cardsRequest !== null) {
      return;
    }
    this.#cardsRequest = this.#dependencies.makeId();
    this.#send(this.#session, {
      afterOrdinal: this.#cardsCursor,
      limit: MAX_PAGE_SIZE,
      requestId: this.#cardsRequest,
      type: "ReadCards",
    });
  };

  refreshCards = () => {
    if (!this.#sessionReady) {
      return;
    }
    this.#cardsCursor = 0;
    this.#cardsRequest = null;
    this.#update({ cardsLoaded: false, moreCards: false, notice: null });
    this.loadCards();
    void this.refreshProfile();
  };

  refreshProfile = async () => {
    const socket = this.#session;
    if (!this.#sessionReady || socket === null || this.#view.profileLoading) {
      return;
    }
    this.#update({
      profile: null,
      profileLoading: true,
      profileUnavailable: false,
    });
    try {
      const profile = await this.#dependencies.readCurrentProfile();
      if (this.#session === socket) {
        this.#update({ profile, profileLoading: false });
      }
    } catch (error) {
      if (this.#session !== socket) {
        return;
      }
      if (
        error instanceof ProfileOperationError &&
        error.code === "authentication_required"
      ) {
        this.#lost(1008);
        return;
      }
      this.#update({ profileLoading: false, profileUnavailable: true });
    }
  };

  checkConfirmation = async () => {
    const socket = this.#session;
    const mutationId = this.#view.pendingConfirmation;
    const reference = this.#view.sessionReference;
    const generation = this.#sessionGeneration;
    if (
      !this.#sessionReady ||
      socket === null ||
      mutationId === null ||
      reference === null ||
      generation === null ||
      this.#confirmationAbort !== null ||
      this.#view.confirmationStatus === "retry_required"
    ) {
      return;
    }
    const controller = new AbortController();
    this.#confirmationAbort = controller;
    this.#update({ confirmationStatus: "sending" });
    try {
      const outcome = await this.#dependencies.continueConfirmation(
        reference,
        mutationId,
        generation,
        controller.signal
      );
      if (
        this.#session !== socket ||
        this.#view.pendingConfirmation !== mutationId
      ) {
        return;
      }
      if (outcome === "authentication_required") {
        this.#lost(1008);
        return;
      }
      this.#update({
        confirmationStatus:
          outcome === "accepted" ? "waiting" : "retry_required",
      });
    } catch {
      if (
        this.#session === socket &&
        this.#view.pendingConfirmation === mutationId
      ) {
        this.#update({ confirmationStatus: "retry_required" });
      }
    } finally {
      if (this.#confirmationAbort === controller) {
        this.#confirmationAbort = null;
      }
    }
  };

  reconnectSession = () => {
    if (this.#view.sessionReference !== null) {
      this.select(this.#view.sessionReference);
    }
  };

  reviseCard = (card: ProfileCard, change: ProfileCardChange) => {
    const { profile } = this.#view;
    const session = this.#view.sessionState;
    if (
      profile === null ||
      session === null ||
      !this.#view.cardsLoaded ||
      (card.status !== "proposed" && card.status !== "conflict")
    ) {
      return;
    }
    const reviewedFact =
      change._tag === "AddConfirmedProfileFact"
        ? null
        : profile.facts.find((fact) => fact.id === change.factId)?.value;
    if (reviewedFact === undefined) {
      return;
    }
    const command = Schema.decodeUnknownSync(ReviseProfileCard)({
      cardId: card.id,
      cardRevision: card.revision,
      change,
      expectedProfileVersion: profile.version,
      expectedVersion: session.version,
      mutationId: this.#dependencies.makeId(),
      reviewedFact,
      type: "ReviseProfileCard",
    });
    this.#mutateSession(command);
  };

  rejectCard = (card: ProfileCard) => {
    if (
      this.#view.sessionState === null ||
      !this.#view.cardsLoaded ||
      (card.status !== "proposed" && card.status !== "conflict")
    ) {
      return;
    }
    this.#mutateSession({
      cardId: card.id,
      cardRevision: card.revision,
      expectedVersion: this.#view.sessionState.version,
      mutationId: this.#dependencies.makeId(),
      type: "RejectProfileCard",
    });
  };

  confirmCard = (
    card: ProfileCard,
    safetyConfirmation: typeof ConfirmProfileCard.Type.safetyConfirmation
  ) => {
    if (
      this.#view.sessionState === null ||
      this.#view.profile === null ||
      !this.#view.cardsLoaded ||
      card.status !== "proposed" ||
      card.expectedProfileVersion !== this.#view.profile.version ||
      !matchesCurrentProfileReview(card, this.#view.profile)
    ) {
      return;
    }
    if (
      card.change._tag === "ConfirmHardConstraintReduction" &&
      safetyConfirmation === null
    ) {
      return;
    }
    this.#mutateSession({
      cardId: card.id,
      cardRevision: card.revision,
      expectedVersion: this.#view.sessionState.version,
      mutationId: this.#dependencies.makeId(),
      safetyConfirmation,
      type: "ConfirmProfileCard",
    });
  };

  loadHistory = () => {
    if (!this.#sessionReady || this.#historyRequest !== null) {
      return;
    }
    this.#historyRequest = this.#dependencies.makeId();
    this.#send(this.#session, {
      afterOrdinal: this.#historyCursor,
      limit: MAX_PAGE_SIZE,
      requestId: this.#historyRequest,
      type: "ReadHistory",
    });
  };

  reviewHistory = () => {
    if (!this.#sessionReady) {
      return;
    }
    this.#historyCursor = 0;
    this.#historyRequest = null;
    this.#update({
      historyLoaded: false,
      messages: [],
      moreHistory: false,
      notice: null,
    });
    this.loadHistory();
    this.refreshCards();
  };

  #mutateSession(command: SessionMutation) {
    if (
      !this.#sessionReady ||
      this.#bindingKey === null ||
      this.#view.sessionReference === null ||
      this.#view.pending !== null ||
      this.#view.pendingConfirmation !== null ||
      this.#view.notice !== null ||
      !this.#view.historyLoaded ||
      this.#view.sessionState?.status !== "open"
    ) {
      return;
    }
    const pending = {
      bindingKey: this.#bindingKey,
      command,
      sessionReference: this.#view.sessionReference,
    };
    if (this.#retain(pending)) {
      this.#send(this.#session, command);
    }
  }

  append = (text: string) => {
    if (this.#view.sessionState === null || text.trim().length === 0) {
      return;
    }
    const command = Schema.decodeUnknownSync(AppendParticipantMessage)({
      expectedVersion: this.#view.sessionState.version,
      mutationId: this.#dependencies.makeId(),
      text,
      type: "AppendParticipantMessage",
    });
    this.#mutateSession(command);
  };

  complete = () => {
    if (this.#view.sessionState === null) {
      return;
    }
    this.#mutateSession({
      expectedVersion: this.#view.sessionState.version,
      mutationId: this.#dependencies.makeId(),
      type: "CompleteSession",
    });
  };

  retry = () => {
    const { pending } = this.#view;
    if (pending === null || pending.bindingKey !== this.#bindingKey) {
      return;
    }
    if (pending.command.type === "StartSession") {
      if (this.#directoryReady) {
        this.#send(this.#directory, pending.command);
      }
    } else if (
      this.#sessionReady &&
      pending.sessionReference === this.#view.sessionReference
    ) {
      this.#send(this.#session, pending.command);
    }
  };
}

export const browserPrivateInterviewDependencies =
  (): PrivateInterviewDependencies => ({
    connect: (path) => {
      const url = new URL(path, globalThis.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      const transport: PrivateInterviewSocket = {
        close: () => socket.close(),
        onDisconnect: null,
        onFailure: null,
        onFrame: null,
        send: (data) => socket.send(data),
      };
      socket.addEventListener("message", (event) =>
        transport.onFrame?.({ data: event.data })
      );
      socket.addEventListener("close", (event) =>
        transport.onDisconnect?.({ code: event.code })
      );
      socket.addEventListener("error", () => transport.onFailure?.());
      return transport;
    },
    continueConfirmation: continuePrivateConfirmation,
    makeId: () => crypto.randomUUID(),
    readCurrentProfile: readCurrentPrivateProfile,
    storage: {
      getItem: (key) => globalThis.sessionStorage.getItem(key),
      removeItem: (key) => globalThis.sessionStorage.removeItem(key),
      setItem: (key, value) => globalThis.sessionStorage.setItem(key, value),
    },
  });
