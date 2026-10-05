import {
  MealPlanId,
  MealPlanNotFound,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
} from "@meal-planner/household-api";
import type {
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  MealPlan,
  MealPlanActorId,
  MealPlanApproved,
  MealPlanAudit,
  MealPlanCoverage,
  MealPlanChange,
  MealPlanDraft,
  MealPlanInstant,
  MealPlanMutationId,
  MealPlanRequest,
  MealPlanRuleViolation,
  MealPlanMutationConflict,
  MealPlanPersistenceFailure,
  MealPlanRequestConflict,
} from "@meal-planner/household-api";
import { Effect, Option, Schema } from "effect";

import {
  changePlanVersion,
  makeInitialPlanVersion,
  rebasePlanVersion,
  repinPlanVersion,
  requiredCoverage,
  requirementIdentity,
  validatePlanVersion,
} from "./planning-kernel.js";
import type { PlanningAuthority } from "./planning-kernel.js";

export type MealPlanRepositoryError =
  | MealPlanMutationConflict
  | MealPlanNotFound
  | MealPlanPersistenceFailure
  | MealPlanTransitionRejected
  | MealPlanVersionConflict
  | MealPlanRuleViolation;

export interface MealPlanRepository {
  readonly create: (input: {
    readonly draft: MealPlanDraft;
    readonly requestFingerprint: string;
  }) => Effect.Effect<
    MealPlan,
    MealPlanPersistenceFailure | MealPlanRequestConflict
  >;
  readonly find: (
    planId: MealPlanId
  ) => Effect.Effect<Option.Option<MealPlan>, MealPlanPersistenceFailure>;
  readonly listRecent: () => Effect.Effect<
    readonly MealPlan[],
    MealPlanPersistenceFailure
  >;
  readonly findMutation: (input: {
    readonly planId: MealPlanId;
    readonly mutationFingerprint: string;
    readonly mutationId: MealPlanMutationId;
  }) => Effect.Effect<
    Option.Option<MealPlan>,
    MealPlanMutationConflict | MealPlanPersistenceFailure
  >;
  readonly save: (input: {
    readonly expectedRevision: number;
    readonly mutationFingerprint: string;
    readonly mutationId: MealPlanMutationId;
    readonly next: MealPlan;
  }) => Effect.Effect<MealPlan, MealPlanRepositoryError>;
}

export type MealPlanServiceError =
  | MealPlanRepositoryError
  | MealPlanRequestConflict
  | MealPlanRuleViolation;

export interface MealPlanAdmittedCommand {
  readonly planId: MealPlanId;
  readonly actorId: MealPlanActorId;
  readonly at: MealPlanInstant;
}
export type MealPlanChangeCommand = MealPlanAdmittedCommand &
  ChangeMealPlanPayload;
export type MealPlanDecisionCommand = MealPlanAdmittedCommand &
  DecideMealPlanPayload;

export interface MealPlanService {
  readonly create: (
    request: MealPlanRequest,
    authority: PlanningAuthority,
    initialCoverage?: readonly MealPlanCoverage[]
  ) => Effect.Effect<MealPlan, MealPlanServiceError>;
  readonly read: (
    planId: MealPlanId
  ) => Effect.Effect<Option.Option<MealPlan>, MealPlanPersistenceFailure>;
  readonly listRecent: () => Effect.Effect<
    readonly MealPlan[],
    MealPlanPersistenceFailure
  >;
  readonly change: (
    command: MealPlanChangeCommand,
    authority: PlanningAuthority
  ) => Effect.Effect<MealPlan, MealPlanServiceError>;
  readonly approve: (
    command: MealPlanDecisionCommand,
    authority: PlanningAuthority
  ) => Effect.Effect<MealPlanApproved, MealPlanServiceError>;
  readonly proposeRevision: (
    command: MealPlanDecisionCommand,
    authority: PlanningAuthority
  ) => Effect.Effect<MealPlan, MealPlanServiceError>;
  readonly acceptRevision: (
    command: MealPlanDecisionCommand,
    authority: PlanningAuthority
  ) => Effect.Effect<MealPlanApproved, MealPlanServiceError>;
  readonly rejectRevision: (
    command: MealPlanDecisionCommand
  ) => Effect.Effect<MealPlanApproved, MealPlanServiceError>;
}

const ruleViolation = (
  reason: MealPlanRuleViolation["reason"]
): MealPlanRuleViolation => ({ _tag: "MealPlanRuleViolation", reason });
const notFound = (planId: MealPlanId) => MealPlanNotFound.make({ planId });
const versionConflict = (expectedRevision: number, actualRevision: number) =>
  MealPlanVersionConflict.make({ actualRevision, expectedRevision });
const transitionRejected = (lifecycle: MealPlan["_tag"]) =>
  MealPlanTransitionRejected.make({ lifecycle });

const requirePlan = (repository: MealPlanRepository, planId: MealPlanId) =>
  repository.find(planId).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(notFound(planId)),
        onSome: Effect.succeed,
      })
    )
  );

const mutationFingerprint = (
  action: string,
  command: MealPlanChangeCommand | MealPlanDecisionCommand
): string =>
  JSON.stringify({
    action,
    actorId: command.actorId,
    change: "change" in command ? command.change : null,
    expectedRevision: command.expectedRevision,
    mutationId: command.mutationId,
    planId: command.planId,
    reason: command.reason,
  });

const changeAuditAction: Record<
  MealPlanChange["_tag"],
  MealPlanAudit["action"]
> = {
  RefreshInputs: "refresh_inputs",
  RemoveCookEvent: "remove_cook_event",
  ReplaceDraftPlan: "change_coverage",
  ReplaceMealEvent: "change_coverage",
  SetCookEvent: "set_cook_event",
  SetCoverage: "change_coverage",
};

const audit = (
  command: MealPlanChangeCommand | MealPlanDecisionCommand,
  action: MealPlanAudit["action"],
  changedRequirements: MealPlanAudit["changedRequirements"] = []
): MealPlanAudit => ({
  action,
  actorId: command.actorId,
  at: command.at,
  changedRequirements,
  mutationId: command.mutationId,
  reason: command.reason,
});

const isRuleViolation = (
  result: ReturnType<typeof changePlanVersion>
): result is MealPlanRuleViolation => "_tag" in result;

export const makeMealPlanService = (
  repository: MealPlanRepository
): MealPlanService => {
  const mutate = (
    action: string,
    command: MealPlanChangeCommand | MealPlanDecisionCommand,
    transition: (
      current: MealPlan
    ) => Effect.Effect<
      MealPlan,
      MealPlanRuleViolation | MealPlanTransitionRejected
    >
  ) =>
    Effect.gen(function* applyMealPlanMutation() {
      const fingerprint = mutationFingerprint(action, command);
      const replay = yield* repository.findMutation({
        mutationFingerprint: fingerprint,
        mutationId: command.mutationId,
        planId: command.planId,
      });
      if (Option.isSome(replay)) {
        return replay.value;
      }
      const current = yield* requirePlan(repository, command.planId);
      if (current.revision !== command.expectedRevision) {
        return yield* Effect.fail(
          versionConflict(command.expectedRevision, current.revision)
        );
      }
      const next = yield* transition(current);
      return yield* repository.save({
        expectedRevision: command.expectedRevision,
        mutationFingerprint: fingerprint,
        mutationId: command.mutationId,
        next,
      });
    });

  return {
    acceptRevision: (command, authority) =>
      mutate("accept_revision", command, (current) => {
        if (current._tag !== "ProposedRevision") {
          return Effect.fail(transitionRejected(current._tag));
        }
        const issue = validatePlanVersion(
          current.proposed,
          current.request,
          authority,
          true
        );
        if (issue !== null) {
          return Effect.fail(issue);
        }
        return Effect.succeed({
          _tag: "Approved" as const,
          active: current.proposed,
          audit: [...current.audit, audit(command, "accept_revision")],
          planId: current.planId,
          request: current.request,
          revision: current.revision + 1,
        });
      }).pipe(
        Effect.flatMap((plan) =>
          plan._tag === "Approved"
            ? Effect.succeed(plan)
            : Effect.die("Revision replay has the wrong lifecycle")
        )
      ),
    approve: (command, authority) =>
      mutate("approve", command, (current) => {
        if (current._tag !== "Draft") {
          return Effect.fail(transitionRejected(current._tag));
        }
        const issue = validatePlanVersion(
          current.proposed,
          current.request,
          authority,
          true
        );
        if (issue !== null) {
          return Effect.fail(issue);
        }
        return Effect.succeed({
          _tag: "Approved" as const,
          active: current.proposed,
          audit: [...current.audit, audit(command, "approve")],
          planId: current.planId,
          request: current.request,
          revision: current.revision + 1,
        });
      }).pipe(
        Effect.flatMap((plan) =>
          plan._tag === "Approved"
            ? Effect.succeed(plan)
            : Effect.die("Approval replay has the wrong lifecycle")
        )
      ),
    change: (command, authority) =>
      mutate("change", command, (current) => {
        if (current._tag === "Approved") {
          return Effect.fail(transitionRejected(current._tag));
        }
        const working = current.proposed;
        if (command.change._tag !== "RefreshInputs") {
          const currentIssue = validatePlanVersion(
            working,
            current.request,
            authority,
            false
          );
          if (currentIssue !== null) {
            return Effect.fail(currentIssue);
          }
        }
        const changed =
          command.change._tag === "RefreshInputs"
            ? rebasePlanVersion(working, current.request, authority)
            : changePlanVersion(
                working,
                command.change,
                current.request,
                authority
              );
        if (isRuleViolation(changed)) {
          return Effect.fail(changed);
        }
        const proposed =
          command.change._tag === "RefreshInputs"
            ? changed.version
            : repinPlanVersion(changed.version, authority);
        const next: MealPlan = {
          ...current,
          audit: [
            ...current.audit,
            audit(
              command,
              changeAuditAction[command.change._tag],
              changed.changed
            ),
          ],
          proposed,
          revision: current.revision + 1,
        };
        return Effect.succeed(next);
      }),
    create: (request, authority, initialCoverage = []) => {
      const planId = Schema.decodeUnknownSync(MealPlanId)(request.requestKey);
      const expected = new Set(
        requiredCoverage(request, authority).map(requirementIdentity)
      );
      const supplied = initialCoverage.map(({ requirement }) =>
        requirementIdentity(requirement)
      );
      if (expected.size === 0) {
        return Effect.fail(ruleViolation("config_missing"));
      }
      if (
        supplied.length !== new Set(supplied).size ||
        supplied.some((key) => !expected.has(key))
      ) {
        return Effect.fail(ruleViolation("invalid_requirement_matrix"));
      }
      const proposed = makeInitialPlanVersion(
        request,
        authority,
        initialCoverage
      );
      const issue = validatePlanVersion(proposed, request, authority, false);
      if (issue !== null) {
        return Effect.fail(issue);
      }
      const draft: MealPlanDraft = {
        _tag: "Draft",
        audit: [],
        planId,
        proposed,
        request,
        revision: 0,
      };
      return repository.create({
        draft,
        requestFingerprint: JSON.stringify(request),
      });
    },
    listRecent: repository.listRecent,
    proposeRevision: (command, authority) =>
      mutate("propose_revision", command, (current) => {
        if (current._tag !== "Approved") {
          return Effect.fail(transitionRejected(current._tag));
        }
        const rebased = rebasePlanVersion(
          current.active,
          current.request,
          authority
        );
        return Effect.succeed({
          _tag: "ProposedRevision" as const,
          active: current.active,
          audit: [
            ...current.audit,
            audit(command, "propose_revision", rebased.changed),
          ],
          planId: current.planId,
          proposed: { ...rebased.version, number: current.active.number + 1 },
          request: current.request,
          revision: current.revision + 1,
        });
      }),
    read: repository.find,
    rejectRevision: (command) =>
      mutate("reject_revision", command, (current) => {
        if (current._tag !== "ProposedRevision") {
          return Effect.fail(transitionRejected(current._tag));
        }
        return Effect.succeed({
          _tag: "Approved" as const,
          active: current.active,
          audit: [...current.audit, audit(command, "reject_revision")],
          planId: current.planId,
          request: current.request,
          revision: current.revision + 1,
        });
      }).pipe(
        Effect.flatMap((plan) =>
          plan._tag === "Approved"
            ? Effect.succeed(plan)
            : Effect.die("Rejection replay has the wrong lifecycle")
        )
      ),
  };
};
