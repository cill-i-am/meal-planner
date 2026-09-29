import type {
  ConversationAction,
  ConversationActionState,
  ConversationBlock,
  ConversationView,
} from "@meal-planner/agent-conversations-api";
import {
  AgentConversationsApi,
  ConversationChatMetadata,
  ConversationConflict,
  ConversationForbidden,
  ConversationInvalid,
  ConversationSchemaErrors,
  ConversationTurnId,
  ConversationUnauthorized,
  ConversationUnavailable,
} from "@meal-planner/agent-conversations-api";
import {
  FamilyService,
  FamilyServiceLive,
} from "@meal-planner/families/application";
import type {
  HouseholdPersonDisplayName,
  HouseholdPersonId,
  MealPlanId,
  ProfileCommand,
  UserId,
} from "@meal-planner/household-api";
import {
  HouseholdOrganizationId,
  HouseholdPeoplePrincipal,
  HouseholdPersonMutationId,
  MealPlan,
  MealPlanMutationId,
  MutatePlanningContentPayload,
  ChangeMealPlanPayload,
  PlanningContentId,
  PlanningContentMutationId,
  PersonProfile,
  PlanningContentSnapshot,
  toHouseholdMealPlanResponse,
} from "@meal-planner/household-api";
import {
  chatParamsFromRequestBody,
  convertMessagesToModelMessages,
} from "@tanstack/ai";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Option, Result, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/unstable/httpapi";

import type {
  ActionExecution,
  AdvanceConversationAction,
} from "./features/agent-conversations/conversation-session.js";
import {
  ConversationAccess,
  ConversationCanonicalContext,
  ConversationChatInput,
} from "./features/agent-conversations/conversation.contract.js";
import { conversationObjectName } from "./features/agent-conversations/conversation.identity.js";
import type { AuthenticatedOrganizationResolver } from "./features/auth/auth.principal.js";
import { authorizeApplicationRequest } from "./features/auth/http.js";
import type { MealPlannerAuthService } from "./features/auth/index.js";
import { FamilyStoreLive } from "./features/families/index.js";
import type { HouseholdDomainWorkerMethods } from "./features/households/household-domain-worker.js";
import { makeHouseholdPeopleGateway } from "./features/households/household-request-composition.js";
import type { HouseholdPeopleGateway } from "./features/households/household.gateway.js";
import { HouseholdCreatorLive } from "./features/households/membership.js";
import { makeHouseholdPeopleControlPlane } from "./features/households/people/household-people.control-plane.js";
import {
  deriveHouseholdPeopleAuditActorId,
  deriveHouseholdPersonLinkageSubject,
} from "./features/households/people/household-people.identity.js";
import type { MemberDepartureWorkflowStarter } from "./features/households/people/member-departure.js";
import { makeHouseholdPeopleAdmission } from "./features/households/rpc/command-envelope.js";
import { JsonHttpPlatformServices } from "./infrastructure/json-http-platform.js";

type Access = typeof ConversationAccess.Type;
type Action = typeof ConversationAction.Type;
interface Account {
  readonly id: UserId;
  readonly name: HouseholdPersonDisplayName;
}

/** The trusted service binding never accepts a browser-selected object name. */
export interface AgentConversationStub {
  readonly initialize: (
    access: Access
  ) => Promise<typeof ConversationView.Type>;
  readonly read: (access: Access) => Promise<typeof ConversationView.Type>;
  readonly beginAction: (input: {
    readonly access: Access;
    readonly action: Action;
  }) => Promise<ActionExecution>;
  readonly advanceAction: (
    input: AdvanceConversationAction
  ) => Promise<ActionExecution>;
  readonly markActionUnknown: (input: {
    readonly access: Access;
    readonly actionId: Action["actionId"];
  }) => Promise<ActionExecution>;
  readonly rejectAction: (input: {
    readonly access: Access;
    readonly actionId: Action["actionId"];
    readonly reason: "permission_denied" | "stale_review" | "not_actionable";
  }) => Promise<ActionExecution>;
  readonly actionState: (
    execution: ActionExecution
  ) => Promise<typeof ConversationActionState.Type>;
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface AgentConversationNamespace {
  readonly getByName: (name: string) => AgentConversationStub;
}

export interface AgentConversationHostOptions {
  readonly auth: MealPlannerAuthService;
  readonly conversations: AgentConversationNamespace;
  readonly database: DrizzleD1Database;
  readonly domain: HouseholdDomainWorkerMethods;
  readonly departureWorkflow: MemberDepartureWorkflowStarter;
  readonly headers: Headers;
  readonly resolver: AuthenticatedOrganizationResolver;
  readonly sendInvitationEmail: Parameters<
    typeof makeHouseholdPeopleGateway
  >[0]["sendInvitationEmail"];
}

const unauthorized = () =>
  ConversationUnauthorized.make({
    code: "unauthorized",
    message: "Sign in to continue.",
    status: 401,
  });
const forbidden = () =>
  ConversationForbidden.make({
    code: "conversation_forbidden",
    message: "This conversation is unavailable to your account.",
    status: 403,
  });
const conflict = () =>
  ConversationConflict.make({
    code: "conversation_conflict",
    message: "The conversation changed. Refresh and try again.",
    status: 409,
  });
const unavailable = () =>
  ConversationUnavailable.make({
    code: "conversation_unavailable",
    message: "The result could not be confirmed. Retry the same request.",
    status: 503,
  });
const invalid = () =>
  ConversationInvalid.make({
    code: "conversation_invalid",
    message: "Check the conversation request and try again.",
    status: 400,
  });

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};
const SessionProblem = Schema.Struct({
  reason: Schema.Literals([
    "binding_conflict",
    "stale_version",
    "turn_conflict",
    "action_conflict",
    "stale_review",
    "not_actionable",
  ]),
});

const objectCall = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (error) => {
      const parsed = Schema.decodeUnknownOption(SessionProblem)(error);
      if (Option.isSome(parsed)) {
        switch (parsed.value.reason) {
          case "binding_conflict": {
            return forbidden();
          }
          case "stale_version":
          case "turn_conflict":
          case "action_conflict":
          case "stale_review": {
            return conflict();
          }
          case "not_actionable": {
            return invalid();
          }
          default: {
            return unavailable();
          }
        }
      }
      return unavailable();
    },
    try: call,
  });

/** The host supplies the actor, canonical state, and exact reviewed writes. */
export const makeAgentConversationHost = (
  options: AgentConversationHostOptions
) => {
  const families = FamilyServiceLive.pipe(
    Layer.provide(HouseholdCreatorLive(options.domain)),
    Layer.provide(FamilyStoreLive(options.database))
  );
  const people: HouseholdPeopleGateway = makeHouseholdPeopleGateway({
    controlPlane: makeHouseholdPeopleControlPlane({
      auth: options.auth,
      database: options.database,
    }),
    departureWorkflow: options.departureWorkflow,
    domain: options.domain,
    sendInvitationEmail: options.sendInvitationEmail,
  });
  const account = authorizeApplicationRequest(options.auth).pipe(
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect maps its typed error channel synchronously.
    Effect.mapError((error) => {
      switch (error.statusCode) {
        case 401: {
          return unauthorized();
        }
        case 403: {
          return forbidden();
        }
        default: {
          return unavailable();
        }
      }
    })
  );
  const stubFor = (access: Access) =>
    Effect.gen(function* findConversationStub() {
      const name = yield* Effect.tryPromise({
        catch: unavailable,
        try: () => conversationObjectName(access),
      });
      return yield* Effect.try({
        catch: unavailable,
        try: () => options.conversations.getByName(name),
      });
    });
  const principalFor = (familyId: HouseholdOrganizationId, actor: Account) =>
    Effect.gen(function* resolvePeoplePrincipal() {
      const membership = yield* options.resolver
        .resolve(options.headers, familyId)
        .pipe(Effect.mapError(forbidden));
      const [actorId, linkageSubject] = yield* Effect.all([
        deriveHouseholdPeopleAuditActorId(familyId, actor.id),
        deriveHouseholdPersonLinkageSubject(familyId, actor.id),
      ]).pipe(Effect.mapError(unavailable));
      return yield* Schema.decodeUnknownEffect(HouseholdPeoplePrincipal)({
        actorId,
        creatorAuthority:
          membership.membershipRole === "owner" ? "better_auth_owner" : null,
        linkageSubject,
        organizationId: familyId,
      }).pipe(Effect.mapError(unavailable));
    });
  const admitLinkedAdult = (
    familyId: HouseholdOrganizationId,
    actor: Account
  ) =>
    Effect.gen(function* admitLinkedAdultToSharedConversation() {
      const principal = yield* principalFor(familyId, actor);
      const roster = yield* people
        .list({ includeArchived: false, principal })
        .pipe(Effect.mapError(forbidden));
      const linkedAdult = roster.people.find(
        (person) =>
          person.id === roster.currentPersonId &&
          person.kind === "adult" &&
          person.lifecycle === "active"
      );
      if (linkedAdult === undefined) {
        return yield* Effect.fail(forbidden());
      }
    });
  const accessFor = (familyId?: HouseholdOrganizationId) =>
    Effect.gen(function* resolveConversationAccess() {
      const actor = yield* account;
      if (familyId !== undefined) {
        yield* admitLinkedAdult(familyId, actor);
      }
      const key = yield* Effect.tryPromise({
        catch: unavailable,
        try: () => sha256(actor.id),
      });
      return {
        access: Schema.decodeUnknownSync(ConversationAccess)({
          accountKey: key,
          scope:
            familyId === undefined
              ? { _tag: "AccountPrivateSetup" }
              : { _tag: "FamilyShared", familyId },
        }),
        actor,
      };
    });
  const contextFor = (
    access: Access,
    actor: Account,
    focusPersonId: HouseholdPersonId | null,
    selectedPlanId: MealPlanId | null
  ) =>
    Effect.gen(function* readCanonicalConversationContext() {
      if (access.scope._tag === "AccountPrivateSetup") {
        if (focusPersonId !== null || selectedPlanId !== null) {
          return yield* Effect.fail(invalid());
        }
        return Schema.decodeUnknownSync(ConversationCanonicalContext)({
          family: null,
          people: [],
          plan: null,
          planningContent: null,
          profiles: [],
          setupAccountDisplayName: actor.name,
        });
      }
      const { familyId } = access.scope;
      const family = yield* Effect.gen(function* family() {
        const service = yield* FamilyService;
        return yield* service.get(actor, familyId);
      }).pipe(Effect.provide(families), Effect.mapError(unavailable));
      const principal = yield* principalFor(familyId, actor);
      const roster = yield* people
        .list({ includeArchived: false, principal })
        .pipe(Effect.mapError(unavailable));
      const active = roster.people.filter(
        (person) => person.lifecycle === "active"
      );
      if (roster.currentPersonId === null) {
        return yield* Effect.fail(forbidden());
      }
      if (focusPersonId !== null) {
        const focus = active.find((person) => person.id === focusPersonId);
        if (
          focus === undefined ||
          (focus.kind === "adult" && focus.id !== roster.currentPersonId)
        ) {
          return yield* Effect.fail(forbidden());
        }
      }
      const profiles = yield* Effect.all(
        active.map((person) =>
          people.getProfile({ personId: person.id, principal }).pipe(
            Effect.map((profile) =>
              Schema.decodeUnknownSync(PersonProfile)({
                audit: null,
                facts: profile.facts.filter(
                  (fact) => fact.standing._tag === "confirmed"
                ),
                personId: profile.personId,
                version: profile.version,
              })
            ),
            Effect.mapError(unavailable)
          )
        )
      );
      const admission = yield* makeHouseholdPeopleAdmission(principal).pipe(
        Effect.mapError(unavailable)
      );
      const contentWire = yield* options.domain
        .readPlanningContent({ admission })
        .pipe(Effect.mapError(unavailable));
      const planningContent = yield* Schema.decodeUnknownEffect(
        PlanningContentSnapshot
      )(contentWire).pipe(Effect.mapError(unavailable));
      let plan: ReturnType<typeof toHouseholdMealPlanResponse> | null = null;
      if (selectedPlanId !== null) {
        const wire = yield* options.domain
          .readMealPlan({ admission, planId: selectedPlanId })
          .pipe(Effect.mapError(unavailable));
        if (wire === null) {
          return yield* Effect.fail(conflict());
        }
        const saved = yield* Schema.decodeUnknownEffect(MealPlan)(wire).pipe(
          Effect.mapError(unavailable)
        );
        plan = toHouseholdMealPlanResponse(saved);
      }
      return Schema.decodeUnknownSync(ConversationCanonicalContext)({
        family,
        people: active,
        plan,
        planningContent,
        profiles,
        setupAccountDisplayName: null,
      });
    });
  const read = (familyId?: HouseholdOrganizationId) =>
    Effect.gen(function* readConversation() {
      const { access } = yield* accessFor(familyId);
      const stub = yield* stubFor(access);
      return yield* objectCall(() => stub.initialize(access));
    });
  const applyRosterStep = (
    execution: ActionExecution,
    access: Access,
    actor: Account,
    commandId: string
  ) =>
    Effect.gen(function* applyRosterStepEffect() {
      const { block, nextStep } = execution;
      const review =
        execution.action.decision === "accept"
          ? execution.action.reviewedRoster
          : null;
      if (
        block._tag !== "RosterProposal" ||
        review === null ||
        access.scope._tag !== "AccountPrivateSetup"
      ) {
        return yield* Effect.fail(invalid());
      }
      const mutationId = Schema.decodeUnknownSync(HouseholdPersonMutationId)(
        commandId
      );
      if (nextStep === 0) {
        const digest = yield* Effect.tryPromise({
          catch: unavailable,
          try: () => sha256(JSON.stringify([actor.id, mutationId])),
        });
        const expectedFamilyId = `family-${digest}`;
        const existing = yield* Effect.gen(function* listBeforeCreate() {
          const service = yield* FamilyService;
          return yield* service.list(actor);
        }).pipe(Effect.provide(families), Effect.mapError(unavailable));
        if (
          existing.length > 0 &&
          !existing.some((family) => family.id === expectedFamilyId)
        ) {
          return yield* Effect.fail(conflict());
        }
        const family = yield* Effect.gen(function* createReviewedFamily() {
          const service = yield* FamilyService;
          return yield* service.create(
            { id: actor.id, name: review.creatorName },
            { mutationId, name: review.familyName }
          );
        }).pipe(
          Effect.provide(families),
          Effect.mapError((error) => {
            if (error.reason === "unavailable") {
              return unavailable();
            }
            if (error.reason === "forbidden") {
              return forbidden();
            }
            return conflict();
          })
        );
        return family.id;
      }
      const person = review.people[nextStep - 1];
      if (person === undefined || execution.familyId === null) {
        return yield* Effect.fail(unavailable());
      }
      const familyId = yield* Schema.decodeUnknownEffect(
        HouseholdOrganizationId
      )(execution.familyId).pipe(Effect.mapError(unavailable));
      const principal = yield* principalFor(familyId, actor);
      yield* people
        .create({
          payload: {
            displayName: person.displayName,
            kind: person.kind,
            mutationId,
          },
          principal,
        })
        .pipe(
          Effect.mapError((error) =>
            error._tag === "HouseholdPeopleUnavailable"
              ? unavailable()
              : conflict()
          )
        );
      return null;
    });

  const profileCommandFor = (
    block: Extract<ConversationBlock, { readonly _tag: "PersonFactProposal" }>,
    basis: "self" | "household_adult",
    safetyConfirmation: "I confirm this safety constraint change" | null
  ): Effect.Effect<
    ProfileCommand,
    ReturnType<typeof forbidden> | ReturnType<typeof invalid>
  > => {
    if (
      block.requiresSafetyConfirmation &&
      safetyConfirmation !== "I confirm this safety constraint change"
    ) {
      return Effect.fail(forbidden());
    }
    const { change } = block;
    switch (change._tag) {
      case "Add": {
        return Effect.succeed({
          _tag: "AddConfirmedProfileFact",
          basis,
          fact: change.fact,
        });
      }
      case "Confirm": {
        return Effect.succeed({
          _tag: "ConfirmProfileFact",
          basis,
          factId: change.factId,
        });
      }
      case "Replace": {
        if (block.requiresSafetyConfirmation) {
          return Effect.succeed({
            _tag: "ConfirmHardConstraintReduction",
            confirmation: "I confirm this safety constraint change",
            factId: change.factId,
            replacement: change.fact,
          });
        }
        return change.fact._tag === "FoodPreference"
          ? Effect.succeed({
              _tag: "ReplaceOrdinaryProfileFact",
              fact: change.fact,
              factId: change.factId,
            })
          : Effect.fail(invalid());
      }
      case "Remove": {
        return block.requiresSafetyConfirmation
          ? Effect.succeed({
              _tag: "ConfirmHardConstraintReduction",
              confirmation: "I confirm this safety constraint change",
              factId: change.factId,
              replacement: null,
            })
          : Effect.succeed({
              _tag: "RemoveOrdinaryProfileFact",
              factId: change.factId,
            });
      }
      default: {
        return Effect.fail(invalid());
      }
    }
  };

  const applyFactStep = (
    execution: ActionExecution,
    block: Extract<ConversationBlock, { readonly _tag: "PersonFactProposal" }>,
    familyId: HouseholdOrganizationId,
    actor: Account,
    commandId: string
  ) =>
    Effect.gen(function* applyFactStepEffect() {
      const acceptedAction =
        execution.action.decision === "accept" ? execution.action : null;
      if (acceptedAction === null) {
        return yield* Effect.fail(invalid());
      }
      const principal = yield* principalFor(familyId, actor);
      const roster = yield* people
        .list({ includeArchived: false, principal })
        .pipe(Effect.mapError(unavailable));
      const target = roster.people.find(
        (person) =>
          person.id === block.personId && person.lifecycle === "active"
      );
      if (
        target === undefined ||
        roster.currentPersonId === null ||
        (target.kind === "adult" && target.id !== roster.currentPersonId)
      ) {
        return yield* Effect.fail(forbidden());
      }
      const profile = yield* people
        .getProfile({ personId: target.id, principal })
        .pipe(Effect.mapError(unavailable));
      const { change } = block;
      // The canonical receipt wins on retry after a successful write. Only compare
      // the reviewed fact while the profile still has the proposed version.
      if (profile.version === block.profileVersion && change._tag !== "Add") {
        const currentFact = profile.facts.find(
          (fact) => fact.id === change.factId
        );
        if (
          currentFact === undefined ||
          JSON.stringify(currentFact.value) !==
            JSON.stringify(block.reviewedBefore)
        ) {
          return yield* Effect.fail(conflict());
        }
      }
      const basis =
        target.kind === "adult"
          ? ("self" as const)
          : ("household_adult" as const);
      const command = yield* profileCommandFor(
        block,
        basis,
        acceptedAction.safetyConfirmation
      );
      yield* people
        .mutateProfile({
          payload: {
            command,
            expectedProfileVersion: block.profileVersion,
            mutationId: Schema.decodeUnknownSync(HouseholdPersonMutationId)(
              commandId
            ),
          },
          personId: target.id,
          principal,
        })
        .pipe(
          Effect.mapError((error) => {
            if (error.reason === "profile_unavailable") {
              return unavailable();
            }
            if (
              error.reason === "self_required" ||
              error.reason === "adult_required"
            ) {
              return forbidden();
            }
            return conflict();
          })
        );
    });

  const applyRoutineStep = (
    block: Extract<ConversationBlock, { readonly _tag: "RoutineProposal" }>,
    familyId: HouseholdOrganizationId,
    actor: Account,
    commandId: string
  ) =>
    Effect.gen(function* applyRoutineStepEffect() {
      const principal = yield* principalFor(familyId, actor);
      const admission = yield* makeHouseholdPeopleAdmission(principal).pipe(
        Effect.mapError(unavailable)
      );
      const payload = yield* Schema.encodeEffect(MutatePlanningContentPayload)({
        command: {
          _tag: "PutRoutine",
          value: {
            id: Schema.decodeUnknownSync(PlanningContentId)(commandId),
            version: 1,
            ...block.routine,
          },
        },
        expectedVersion: block.expectedContentVersion,
        mutationId: Schema.decodeUnknownSync(PlanningContentMutationId)(
          commandId
        ),
      }).pipe(Effect.mapError(invalid));
      yield* options.domain
        .mutatePlanningContent({ admission, payload })
        .pipe(
          Effect.mapError((error) =>
            error._tag === "PlanningContentRejected" &&
            error.reason !== "unavailable"
              ? conflict()
              : unavailable()
          )
        );
    });

  const applyPlanningContentStep = (
    block: Extract<
      ConversationBlock,
      { readonly _tag: "PlanningContentProposal" }
    >,
    familyId: HouseholdOrganizationId,
    actor: Account,
    commandId: string
  ) =>
    Effect.gen(function* applyPlanningContentStepEffect() {
      const principal = yield* principalFor(familyId, actor);
      const admission = yield* makeHouseholdPeopleAdmission(principal).pipe(
        Effect.mapError(unavailable)
      );
      const payload = yield* Schema.encodeEffect(MutatePlanningContentPayload)({
        command: block.command,
        expectedVersion: block.expectedContentVersion,
        mutationId: Schema.decodeUnknownSync(PlanningContentMutationId)(
          commandId
        ),
      }).pipe(Effect.mapError(invalid));
      yield* options.domain
        .mutatePlanningContent({ admission, payload })
        .pipe(
          Effect.mapError((error) =>
            error._tag === "PlanningContentRejected" &&
            error.reason !== "unavailable"
              ? conflict()
              : unavailable()
          )
        );
    });

  const applyPlanStep = (
    block: Extract<ConversationBlock, { readonly _tag: "PlanChangeProposal" }>,
    familyId: HouseholdOrganizationId,
    actor: Account,
    commandId: string
  ) =>
    Effect.gen(function* applyPlanStepEffect() {
      const principal = yield* principalFor(familyId, actor);
      const admission = yield* makeHouseholdPeopleAdmission(principal).pipe(
        Effect.mapError(unavailable)
      );
      const payload = yield* Schema.encodeEffect(ChangeMealPlanPayload)({
        change: block.change,
        expectedRevision: block.expectedRevision,
        mutationId: Schema.decodeUnknownSync(MealPlanMutationId)(commandId),
        reason: block.explanation,
      }).pipe(Effect.mapError(invalid));
      yield* options.domain
        .changeMealPlan({ admission, payload, planId: block.planId })
        .pipe(
          Effect.mapError((error) => {
            switch (error._tag) {
              case "MealPlanVersionConflict":
              case "MealPlanMutationConflict":
              case "MealPlanNotFound":
              case "MealPlanTransitionRejected":
              case "MealPlanRuleViolation":
              case "MealPlanRequestConflict": {
                return conflict();
              }
              default: {
                return unavailable();
              }
            }
          })
        );
    });

  const applyStep = (
    execution: ActionExecution,
    access: Access,
    actor: Account,
    commandId: string
  ) => {
    const { block } = execution;
    if (block._tag === "RosterProposal") {
      return applyRosterStep(execution, access, actor, commandId);
    }
    if (access.scope._tag !== "FamilyShared") {
      return Effect.fail(invalid());
    }
    switch (block._tag) {
      case "PersonFactProposal": {
        return applyFactStep(
          execution,
          block,
          access.scope.familyId,
          actor,
          commandId
        ).pipe(Effect.as(null));
      }
      case "RoutineProposal": {
        return applyRoutineStep(
          block,
          access.scope.familyId,
          actor,
          commandId
        ).pipe(Effect.as(null));
      }
      case "PlanningContentProposal": {
        return applyPlanningContentStep(
          block,
          access.scope.familyId,
          actor,
          commandId
        ).pipe(Effect.as(null));
      }
      case "PlanChangeProposal": {
        return applyPlanStep(
          block,
          access.scope.familyId,
          actor,
          commandId
        ).pipe(Effect.as(null));
      }
      default: {
        return Effect.fail(invalid());
      }
    }
  };

  const advance = (
    stub: AgentConversationStub,
    access: Access,
    execution: ActionExecution,
    familyId: HouseholdOrganizationId | null
  ) =>
    objectCall(() =>
      stub.advanceAction({
        access,
        actionId: execution.action.actionId,
        completedStep: execution.nextStep,
        familyId,
      })
    );

  const execute = (
    execution: ActionExecution,
    access: Access,
    actor: Account,
    stub: AgentConversationStub
  ) =>
    Effect.gen(function* executeConversationAction() {
      if (
        execution.status === "committed" ||
        execution.status === "rejected" ||
        execution.action.decision === "dismiss"
      ) {
        return yield* objectCall(() => stub.actionState(execution));
      }
      let current = execution;
      while (current.status === "pending" || current.status === "unknown") {
        const atStep = current;
        const commandId = atStep.commandIds[atStep.nextStep];
        if (commandId === undefined) {
          return yield* Effect.fail(unavailable());
        }
        const familyId = yield* applyStep(atStep, access, actor, commandId);
        current = yield* advance(stub, access, atStep, familyId);
      }
      return yield* objectCall(() => stub.actionState(current));
    });
  const act = (action: Action, familyId?: HouseholdOrganizationId) =>
    Effect.gen(function* submitConversationAction() {
      const { access, actor } = yield* accessFor(familyId);
      const stub = yield* stubFor(access);
      yield* objectCall(() => stub.initialize(access));
      const execution = yield* objectCall(() =>
        stub.beginAction({ access, action })
      );
      return yield* execute(execution, access, actor, stub).pipe(
        Effect.catch((error) => {
          if (error.code === "conversation_unavailable") {
            return objectCall(() =>
              stub.markActionUnknown({ access, actionId: action.actionId })
            ).pipe(
              Effect.flatMap((unknown) =>
                objectCall(() => stub.actionState(unknown))
              )
            );
          }
          if (
            error.code === "conversation_conflict" ||
            error.code === "conversation_forbidden" ||
            error.code === "conversation_invalid"
          ) {
            let reason: "permission_denied" | "not_actionable" | "stale_review";
            switch (error.code) {
              case "conversation_forbidden": {
                reason = "permission_denied";
                break;
              }
              case "conversation_invalid": {
                reason = "not_actionable";
                break;
              }
              default: {
                reason = "stale_review";
              }
            }
            return objectCall(() =>
              stub.rejectAction({ access, actionId: action.actionId, reason })
            ).pipe(
              Effect.flatMap((rejected) =>
                objectCall(() => stub.actionState(rejected))
              )
            );
          }
          return Effect.fail(error);
        })
      );
    });
  const chat = (request: Request, familyId?: HouseholdOrganizationId) =>
    Effect.gen(function* submitConversationTurn() {
      const { access, actor } = yield* accessFor(familyId);
      const body = yield* Effect.tryPromise({
        catch: invalid,
        try: () => request.json(),
      });
      const params = yield* Effect.tryPromise({
        catch: invalid,
        try: () => chatParamsFromRequestBody(body),
      });
      const metadata = yield* Schema.decodeUnknownEffect(
        ConversationChatMetadata,
        { onExcessProperty: "error" }
      )(params.forwardedProps).pipe(Effect.mapError(invalid));
      const turnId = yield* Schema.decodeUnknownEffect(ConversationTurnId)(
        params.runId
      ).pipe(Effect.mapError(invalid));
      const latest = convertMessagesToModelMessages(params.messages).at(-1);
      if (latest?.role !== "user") {
        return yield* Effect.fail(invalid());
      }
      const text = latest.content;
      const context = yield* contextFor(
        access,
        actor,
        metadata.focusPersonId,
        metadata.planId
      );
      const stub = yield* stubFor(access);
      const view = yield* objectCall(() => stub.initialize(access));
      if (params.threadId !== view.id) {
        return yield* Effect.fail(forbidden());
      }
      const input = yield* Schema.decodeUnknownEffect(ConversationChatInput)({
        access,
        context,
        focusPersonId: metadata.focusPersonId,
        metadata,
        planId: metadata.planId,
        text,
        turnId,
      }).pipe(Effect.mapError(invalid));
      return yield* objectCall(() =>
        stub.fetch(
          new Request("https://internal/chat", {
            body: JSON.stringify(input),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        )
      );
    });
  return { act, chat, read };
};

export const makeAgentConversationHttpLayer = (
  options: AgentConversationHostOptions
) => {
  const host = makeAgentConversationHost(options);
  const group = HttpApiBuilder.group(
    AgentConversationsApi,
    "agentConversations",
    (handlers) =>
      handlers
        .handle("setup", () => host.read())
        .handle("setupAction", ({ payload }) => host.act(payload))
        .handle("family", ({ params }) => host.read(params.familyId))
        .handle("familyAction", ({ params, payload }) =>
          host.act(payload, params.familyId)
        )
  );
  const schemaErrors = HttpApiMiddleware.layerSchemaErrorTransform(
    ConversationSchemaErrors,
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect middleware requires a synchronous Effect-valued callback.
    (error) =>
      error.kind === "Body" || error.kind === "ResponseHeaders"
        ? Effect.die(error)
        : Effect.fail(invalid())
  );
  return HttpApiBuilder.layer(AgentConversationsApi).pipe(
    Layer.provide(group),
    Layer.provide(schemaErrors),
    Layer.provide(JsonHttpPlatformServices),
    Layer.provide(
      HttpRouter.middleware((effect) =>
        effect.pipe(
          Effect.map(HttpServerResponse.setHeader("cache-control", "no-store"))
        )
      ).layer
    )
  );
};

export const handleAgentConversationChatRequest = (
  options: AgentConversationHostOptions & { readonly request: Request }
) => {
  const path = new URL(options.request.url).pathname;
  const setup = path === "/v1/agent-conversations/setup/chat";
  const familyMatch =
    /^\/v1\/families\/(?<familyId>[^/]+)\/agent-conversation\/chat$/u.exec(
      path
    );
  if (!setup && familyMatch === null) {
    return Effect.succeed(null);
  }
  const familyId =
    familyMatch === null
      ? undefined
      : Schema.decodeUnknownOption(HouseholdOrganizationId)(
          familyMatch.groups?.["familyId"]
        );
  if (familyId !== undefined && Option.isNone(familyId)) {
    return Effect.succeed(
      new Response(null, {
        headers: { "cache-control": "no-store" },
        status: 400,
      })
    );
  }
  if (options.request.method !== "POST") {
    return Effect.succeed(
      new Response(null, {
        headers: { "cache-control": "no-store" },
        status: 405,
      })
    );
  }
  const host = makeAgentConversationHost(options);
  return Effect.gen(function* handleRawConversationChat() {
    const outcome = yield* Effect.result(
      host.chat(
        options.request,
        familyId === undefined ? undefined : Option.getOrUndefined(familyId)
      )
    );
    if (Result.isSuccess(outcome)) {
      return outcome.success;
    }
    return Response.json(outcome.failure, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/problem+json",
      },
      status: outcome.failure.status,
    });
  });
};
