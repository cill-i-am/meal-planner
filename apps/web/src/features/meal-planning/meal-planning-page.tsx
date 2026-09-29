import {
  CreateMealPlanPayload,
  MealPlanDate,
  MealPlanId,
  MealPlanMutationId,
  MealPlanRequestKey,
  MealPlanWeeks,
  HouseholdMealPlanConflictProblem,
} from "@meal-planner/household-api";
import type {
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  HouseholdMealPlanResponse,
  HouseholdPerson,
  MealPlanSummary,
  MealPlanCoverage,
  MealPlanResolution,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { ArrowRightIcon, CalendarDaysIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import { Overlay } from "../../components/ui/responsive-overlay.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.js";
import { FamilyConversationPanel } from "../agent-conversations/index.js";
import type {
  PlanProposalReview,
  PlanProposalReviewActions,
} from "../agent-conversations/index.js";
import { useApiRuntime, queryFailure } from "../api-client/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import { familyRosterQueryOptions } from "../family/index.js";
import {
  foodBookQueryOptions,
  invalidatePlanningContent,
} from "../food-book/index.js";
import { CoverageEditor } from "./coverage-editor.js";
import {
  changeMealPlanMutationOptions,
  createMealPlanMutationOptions,
  decideMealPlanMutationOptions,
  mealPlanDetailQueryOptions,
  mealPlanKey,
  mealPlanListQueryOptions,
} from "./operations.js";
import type { PlanDecision } from "./operations.js";
import { DayPlan, WeekPlan } from "./plan-day.js";
import {
  approvalBlockers,
  coverageChanges,
  dateLabel,
  resolutionLabel,
} from "./plan-projection.js";
import { PlanProposalReviewSheet } from "./plan-proposal-review.js";

interface PlanPerson {
  readonly id: string;
  readonly displayName: string;
}
type PendingRequest =
  | { readonly kind: "create"; readonly payload: CreateMealPlanPayload }
  | {
      readonly kind: "change";
      readonly planId: MealPlanId;
      readonly payload: ChangeMealPlanPayload;
    }
  | {
      readonly kind: PlanDecision;
      readonly planId: MealPlanId;
      readonly payload: DecideMealPlanPayload;
    };

const isoToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const personName = (people: readonly PlanPerson[], personId: string) =>
  people.find((person) => person.id === personId)?.displayName ??
  "Family member";

const occasionName = (snapshot: PlanningContentSnapshot, occasionId: string) =>
  snapshot.managedOccasions.find(
    (occasion) => occasion.occasionId === occasionId
  )?.label ?? "Meal";

type PlanConflictReason =
  (typeof HouseholdMealPlanConflictProblem.Type)["reason"];
const planRejectionCopy: Partial<Record<PlanConflictReason, string>> = {
  availability_unknown: "Confirm where and when this meal can be prepared.",
  config_missing:
    "Choose the family’s managed meals in Food book before starting a plan.",
  config_version_changed:
    "Food book settings changed since this plan was drafted. Refresh plan inputs and review every affected meal.",
  content_version_changed:
    "A saved food version changed. Refresh plan inputs, then review the affected meals and amounts.",
  cook_event_conflict:
    "The planned cooking event changed. Refresh the plan and review its prepared portions.",
  cooking_capacity_exceeded:
    "The plan has more substantial cooking events than the family set.",
  incompatible_option:
    "One saved meal is marked incompatible for a planned person.",
  invalid_requirement_matrix:
    "The people or managed meals changed. Refresh plan inputs before approval.",
  invalid_transition:
    "This action is no longer available in the plan’s current state.",
  missing_equipment:
    "The chosen meal needs equipment the family has not confirmed.",
  mutation_conflict:
    "This request ID was used for a different change. Review the latest plan.",
  preparation_unknown:
    "Review cooking time, effort, equipment and start time in Food book.",
  preparation_window_conflict:
    "This meal does not fit the available preparation window.",
  prepared_output_missing:
    "A prepared portion is unavailable for that date. Choose another meal or confirm the stock source and week.",
  prepared_overallocated:
    "Prepared portions are allocated beyond the confirmed amount.",
  profile_version_changed:
    "A person’s confirmed profile changed. Refresh plan inputs and review the affected meals.",
  quantity_unit_mismatch:
    "A prepared portion uses a different unit from its confirmed source. Review its amount.",
  request_conflict:
    "A plan already exists for this request. Open the latest plan.",
  unresolved_allocation:
    "Enter a known amount for each person’s meal in the plan.",
  unresolved_gap:
    "Every managed person and meal needs a choice before approval.",
  unresolved_shopping:
    "Review the recipe yield and shopping amounts in Food book.",
  unreviewed_suitability:
    "Review this exact meal against each person’s current confirmed profile.",
  version_conflict:
    "The plan changed elsewhere. Refresh before reviewing this request.",
};
const rejectionMessage = (failure: Error): string | null => {
  const unwrapped = queryFailure(failure);
  const wrapped = Schema.decodeUnknownOption(
    Schema.Struct({ cause: Schema.Unknown })
  )(unwrapped);
  const decoded = Schema.decodeUnknownOption(HouseholdMealPlanConflictProblem)(
    Option.isSome(wrapped) ? wrapped.value.cause : unwrapped
  );
  return Option.isSome(decoded)
    ? (planRejectionCopy[decoded.value.reason] ??
        "The server rejected this change. Review the latest plan and its open meals.")
    : null;
};

const displayVersion = (
  plan: HouseholdMealPlanResponse,
  showProposed: boolean
) => {
  switch (plan._tag) {
    case "Approved": {
      return plan.active;
    }
    case "Draft": {
      return plan.proposed;
    }
    case "ProposedRevision": {
      return showProposed ? plan.proposed : plan.active;
    }
    default: {
      throw new Error("Unsupported plan state.");
    }
  }
};
const planStateLabel = (plan: HouseholdMealPlanResponse) => {
  switch (plan._tag) {
    case "Draft": {
      return "Draft for review";
    }
    case "Approved": {
      return "Approved family plan";
    }
    case "ProposedRevision": {
      return "Proposed revision";
    }
    default: {
      return "Family plan";
    }
  }
};
const hasApprovalBlockers = (
  blockers: ReturnType<typeof approvalBlockers>,
  staleInputs: boolean
) =>
  staleInputs ||
  blockers.gaps.length > 0 ||
  blockers.unresolvedAmounts.length > 0 ||
  blockers.unconfirmedCarryOver.length > 0 ||
  blockers.unreviewedSuitability.length > 0 ||
  blockers.incompatibleSuitability.length > 0 ||
  blockers.unknownSafety.length > 0 ||
  blockers.overallocatedPrepared.length > 0 ||
  blockers.preparationUnknown.length > 0 ||
  blockers.preparationWindowConflicts.length > 0 ||
  blockers.availabilityUnknown.length > 0 ||
  blockers.missingEquipment.length > 0 ||
  blockers.cookingCapacityExceeded;
const PlanReviewActions = ({
  plan,
  people,
  snapshot,
  proposedSnapshot,
  differences,
  blockers,
  staleInputs,
  hasBlockers,
  pending,
  onDecision,
  onRefreshInputs,
  showProposed,
  setShowProposed,
}: {
  readonly plan: HouseholdMealPlanResponse;
  readonly people: readonly PlanPerson[];
  readonly snapshot: PlanningContentSnapshot;
  readonly proposedSnapshot: PlanningContentSnapshot;
  readonly differences: readonly MealPlanCoverage[];
  readonly blockers: ReturnType<typeof approvalBlockers>;
  readonly staleInputs: boolean;
  readonly hasBlockers: boolean;
  readonly pending: boolean;
  readonly onDecision: (decision: PlanDecision, reason: string) => void;
  readonly onRefreshInputs: () => void;
  readonly showProposed: boolean;
  readonly setShowProposed: (show: boolean) => void;
}) => (
  <>
    {plan._tag === "ProposedRevision" && (
      <section className="bg-accent rounded-3xl p-6 md:p-8">
        <p className="text-xs font-medium tracking-widest uppercase">
          What would change
        </p>
        <h3 className="font-display mt-2 text-3xl">
          {differences.length} {differences.length === 1 ? "meal" : "meals"} in
          this revision.
        </h3>
        <p className="mt-2 text-sm leading-6">
          The approved plan stays active until you accept this whole revision.
        </p>
        <ul className="divide-border mt-5 divide-y">
          {differences.map((entry) => (
            <li
              key={`${entry.requirement.personId}:${entry.requirement.date}:${entry.requirement.occasion}`}
              className="flex flex-wrap justify-between gap-2 py-3 text-sm"
            >
              <span>
                {dateLabel(entry.requirement.date, {
                  day: "numeric",
                  month: "short",
                  weekday: "short",
                })}{" "}
                · {personName(people, entry.requirement.personId)} ·{" "}
                {occasionName(snapshot, entry.requirement.occasion)}
              </span>
              <span className="font-medium">
                {resolutionLabel(
                  entry.resolution,
                  proposedSnapshot,
                  plan.proposed.cookEvents
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            disabled={pending || hasBlockers}
            onClick={() =>
              onDecision(
                "acceptRevision",
                "Accept the reviewed family plan revision"
              )
            }
          >
            Accept revision
          </Button>
          <Button
            disabled={pending}
            variant="outline"
            onClick={() =>
              onDecision("rejectRevision", "Keep the approved family plan")
            }
          >
            Keep approved plan
          </Button>
        </div>
      </section>
    )}
    {staleInputs && (
      <Alert variant="destructive">
        <AlertTitle>Plan inputs changed</AlertTitle>
        <AlertDescription>
          Food book settings changed since this proposal was pinned. Refresh the
          plan inputs, then review the affected meals and portions.
        </AlertDescription>
      </Alert>
    )}
    {hasBlockers && (
      <Alert>
        <AlertTitle>Needs attention before approval</AlertTitle>
        <AlertDescription>
          {blockers.gaps.length} open meals ·{" "}
          {blockers.unresolvedAmounts.length} unresolved meal allocations or
          amounts · {blockers.unreviewedSuitability.length} person suitability
          reviews · {blockers.incompatibleSuitability.length} incompatible
          choices · {blockers.unknownSafety.length} people with unconfirmed
          safety profiles · {blockers.unconfirmedCarryOver.length} prepared
          portions to confirm · {blockers.overallocatedPrepared.length} prepared
          outputs overallocated · {blockers.preparationUnknown.length} meals
          with unreviewed preparation ·{" "}
          {blockers.preparationWindowConflicts.length} preparation window
          conflicts · {blockers.availabilityUnknown.length} availability gaps ·{" "}
          {blockers.missingEquipment.length} equipment gaps ·{" "}
          {blockers.cookingCapacityExceeded
            ? "cooking capacity exceeded"
            : "cooking capacity fits"}
          . Open the affected meal or Food book to resolve it.
        </AlertDescription>
      </Alert>
    )}
    {plan._tag === "Approved" && (
      <div className="flex flex-wrap">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            onDecision("proposeRevision", "Start a reviewed family plan change")
          }
        >
          Propose a change
        </Button>
      </div>
    )}
    {plan._tag === "Draft" && (
      <div className="flex flex-wrap">
        <Button
          disabled={pending || hasBlockers}
          onClick={() =>
            onDecision("approve", "Approve the reviewed family meal plan")
          }
        >
          Approve this plan
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
        <Button variant="outline" disabled={pending} onClick={onRefreshInputs}>
          Refresh plan inputs
        </Button>
      </div>
    )}
    {plan._tag === "ProposedRevision" && (
      <Button variant="outline" disabled={pending} onClick={onRefreshInputs}>
        Refresh proposed inputs
      </Button>
    )}
    {plan._tag === "ProposedRevision" && (
      <ToggleGroup
        aria-label="Plan version"
        variant="segment"
        value={[showProposed ? "proposed" : "active"]}
        onValueChange={(values) => setShowProposed(values[0] !== "active")}
        className="max-w-sm"
      >
        <ToggleGroupItem value="active">Approved</ToggleGroupItem>
        <ToggleGroupItem value="proposed">Proposed</ToggleGroupItem>
      </ToggleGroup>
    )}
  </>
);

const summaryStateLabel = (state: MealPlanSummary["state"]) => {
  switch (state) {
    case "Draft": {
      return "Draft";
    }
    case "Approved": {
      return "Approved";
    }
    case "ProposedRevision": {
      return "Proposed revision";
    }
    default: {
      return "Plan";
    }
  }
};

const PlanView = ({
  plan,
  snapshot,
  people,
  onChange,
  onDecision,
  onRefreshInputs,
  pending,
}: {
  readonly plan: HouseholdMealPlanResponse;
  readonly snapshot: PlanningContentSnapshot;
  readonly people: readonly PlanPerson[];
  readonly onChange: (
    coverage: MealPlanCoverage,
    resolution: MealPlanResolution,
    reason: string,
    replaceShared: boolean
  ) => void;
  readonly onDecision: (decision: PlanDecision, reason: string) => void;
  readonly onRefreshInputs: () => void;
  readonly pending: boolean;
}) => {
  const [period, setPeriod] = useState(0);
  const [personFilter, setPersonFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<MealPlanCoverage | null>(null);
  const [showProposed, setShowProposed] = useState(plan._tag !== "Approved");
  const version = displayVersion(plan, showProposed);
  const displaySnapshot = {
    ...snapshot,
    options: version.pins.contentSnapshots,
  };
  const proposedSnapshot =
    plan._tag === "ProposedRevision"
      ? { ...snapshot, options: plan.proposed.pins.contentSnapshots }
      : displaySnapshot;
  const days = [
    ...new Set(version.coverage.map((entry) => entry.requirement.date)),
  ].toSorted();
  const visibleDays = days.slice(period * 7, period * 7 + 7);
  const activeDay = selectedDate ?? visibleDays[0];
  const reviewVersion =
    plan._tag === "ProposedRevision" ? plan.proposed : version;
  const reviewSnapshot =
    plan._tag === "ProposedRevision" ? proposedSnapshot : displaySnapshot;
  const blockers = approvalBlockers(
    reviewVersion,
    reviewSnapshot,
    plan.request.startDate
  );
  const differences =
    plan._tag === "ProposedRevision"
      ? coverageChanges(plan.active, plan.proposed)
      : [];
  const staleInputs =
    reviewVersion.pins.configVersion !== snapshot.configVersion;
  const hasBlockers = hasApprovalBlockers(blockers, staleInputs);
  return (
    <div className="flex flex-col gap-5 md:gap-8">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
            {planStateLabel(plan)}
          </p>
          <h1
            id="meal-planning-title"
            className="font-display mt-2 text-4xl leading-none md:text-6xl"
          >
            Your weeks, together.
          </h1>
          <p className="text-muted-foreground mt-3 text-sm">
            From{" "}
            {dateLabel(plan.request.startDate, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}{" "}
            · {plan.request.weeks} {plan.request.weeks === 1 ? "week" : "weeks"}{" "}
            · revision {plan.revision}
          </p>
        </div>
        {plan._tag === "ProposedRevision" && (
          <Badge variant="secondary">Approved plan still active</Badge>
        )}
      </div>
      <PlanReviewActions
        plan={plan}
        people={people}
        snapshot={snapshot}
        proposedSnapshot={proposedSnapshot}
        differences={differences}
        blockers={blockers}
        staleInputs={staleInputs}
        hasBlockers={hasBlockers}
        pending={pending}
        onDecision={onDecision}
        onRefreshInputs={onRefreshInputs}
        showProposed={showProposed}
        setShowProposed={setShowProposed}
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-xs tracking-widest uppercase">
            Week
          </p>
          <ToggleGroup
            aria-label="Week"
            value={[String(period)]}
            onValueChange={(values) => {
              if (values[0]) {
                setPeriod(Number(values[0]));
                setSelectedDate(null);
              }
            }}
            className="flex max-w-full flex-wrap"
          >
            {Array.from({ length: plan.request.weeks }, (_, index) => (
              <ToggleGroupItem key={index} value={String(index)}>
                {index + 1}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Field className="max-w-48">
          <FieldLabel htmlFor="plan-person-filter">Show meals for</FieldLabel>
          <select
            id="plan-person-filter"
            className="border-input bg-control h-11 rounded-xl border px-3"
            value={personFilter}
            onChange={(event) => setPersonFilter(event.target.value)}
          >
            <option value="all">Everyone</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        </Field>
        <ToggleGroup
          aria-label="Plan view"
          variant="segment"
          value={[viewMode]}
          onValueChange={(values) => {
            if (values[0] === "day" || values[0] === "week") {
              setViewMode(values[0]);
            }
          }}
          className="w-52"
        >
          <ToggleGroupItem value="week">Week</ToggleGroupItem>
          <ToggleGroupItem value="day">Day</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {viewMode === "week" ? (
        <WeekPlan
          days={visibleDays}
          version={version}
          personFilter={personFilter}
          people={people}
          snapshot={displaySnapshot}
          onOpenDay={(date) => {
            setSelectedDate(date);
            setViewMode("day");
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ToggleGroup
            aria-label="Day"
            value={[selectedDate ?? visibleDays[0] ?? ""]}
            onValueChange={(values) => {
              if (values[0]) {
                setSelectedDate(values[0]);
              }
            }}
            className="flex max-w-full flex-wrap"
          >
            {visibleDays.map((date) => (
              <ToggleGroupItem key={date} value={date}>
                {dateLabel(date, { day: "numeric", weekday: "short" })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {activeDay && (
            <DayPlan
              date={activeDay}
              version={version}
              personFilter={personFilter}
              people={people}
              snapshot={displaySnapshot}
              onChange={
                plan._tag === "Draft" ||
                (plan._tag === "ProposedRevision" && showProposed)
                  ? setSelected
                  : undefined
              }
            />
          )}
        </div>
      )}
      <Overlay.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
          }
        }}
        desktop="drawer"
      >
        <Overlay.Content data-theme="journey">
          <Overlay.Header>
            <Overlay.Title>Change a meal</Overlay.Title>
            <Overlay.Description>
              Review the person and date before saving.
            </Overlay.Description>
          </Overlay.Header>
          <Overlay.Body>
            {selected && (
              <CoverageEditor
                key={`${selected.requirement.date}:${selected.requirement.occasion}:${selected.requirement.personId}`}
                coverage={selected}
                snapshot={snapshot}
                cookEvents={version.cookEvents}
                people={people}
                pending={pending}
                onClose={() => setSelected(null)}
                onSubmit={(resolution, reason, replaceShared) => {
                  onChange(selected, resolution, reason, replaceShared);
                  setSelected(null);
                }}
              />
            )}
          </Overlay.Body>
        </Overlay.Content>
      </Overlay.Root>
    </div>
  );
};

interface ProposalReviewState {
  readonly block: Parameters<PlanProposalReview>[0];
  readonly actions: PlanProposalReviewActions;
}
const PlanRequestStatus = ({
  requestError,
  retained,
  failure,
  rejectedReason,
  pending,
  loading,
  loadError,
  onReconcile,
  onRetry,
  onReload,
}: {
  readonly requestError: string | null;
  readonly retained: PendingRequest | null;
  readonly failure: Error | null;
  readonly rejectedReason: string | null;
  readonly pending: boolean;
  readonly loading: boolean;
  readonly loadError: boolean;
  readonly onReconcile: () => Promise<void>;
  readonly onRetry: (request: PendingRequest) => void;
  readonly onReload: () => Promise<void>;
}) => (
  <>
    {requestError && (
      <Alert variant="destructive">
        <AlertTitle>Check the plan request</AlertTitle>
        <AlertDescription>{requestError}</AlertDescription>
      </Alert>
    )}
    {retained && failure && (
      <Alert variant="destructive">
        <AlertTitle>
          {rejectedReason ? "Plan request needs review" : "Save result unknown"}
        </AlertTitle>
        <AlertDescription>
          {rejectedReason ??
            "The same request is retained. Check the latest plan before retrying it."}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={onReconcile}>
              <RefreshCwIcon data-icon="inline-start" />
              Check latest plan
            </Button>
            <Button
              variant="outline"
              onClick={() => onRetry(retained)}
              disabled={pending}
            >
              Retry same request
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )}
    {loading && (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    )}
    {loadError && (
      <Alert variant="destructive">
        <AlertTitle>Planning is unavailable</AlertTitle>
        <AlertDescription>
          We couldn’t load the latest plan, people or saved food.{" "}
          <Button variant="link" onClick={onReload}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )}
  </>
);
const PlanLoadedContent = ({
  scope,
  summaries,
  snapshot,
  people,
  hasManagedMeals,
  activeId,
  detailPlan,
  detailPending,
  detailError,
  pending,
  onNew,
  onSelect,
  onReadPlan,
  onChange,
  onDecision,
  onRefreshInputs,
  onProposalReview,
  onPlanCommitted,
  onRefreshPlan,
}: {
  readonly scope: DisplayedIdentity;
  readonly summaries: readonly MealPlanSummary[];
  readonly snapshot: PlanningContentSnapshot;
  readonly people: readonly HouseholdPerson[];
  readonly hasManagedMeals: boolean;
  readonly activeId: MealPlanId | undefined;
  readonly detailPlan: HouseholdMealPlanResponse | undefined;
  readonly detailPending: boolean;
  readonly detailError: boolean;
  readonly pending: boolean;
  readonly onNew: () => void;
  readonly onSelect: (id: MealPlanId) => void;
  readonly onReadPlan: () => Promise<void>;
  readonly onChange: (
    entry: MealPlanCoverage,
    resolution: MealPlanResolution,
    reason: string,
    replaceShared: boolean
  ) => void;
  readonly onDecision: (decision: PlanDecision, reason: string) => void;
  readonly onRefreshInputs: () => void;
  readonly onProposalReview: PlanProposalReview;
  readonly onPlanCommitted: (planId: MealPlanId) => Promise<void>;
  readonly onRefreshPlan: () => Promise<void>;
}) => (
  <>
    {people.length === 0 && (
      <Alert>
        <AlertTitle>People needed</AlertTitle>
        <AlertDescription>
          Add your family members before planning their meals.
        </AlertDescription>
      </Alert>
    )}
    {!hasManagedMeals && (
      <Alert>
        <AlertTitle>Choose the family’s managed meals</AlertTitle>
        <AlertDescription>
          Set up breakfast, lunch, dinner and snacks for the people you plan for
          before creating a draft.{" "}
          <Button variant="link" render={<a href="/?area=food" />}>
            Set up in Food book
          </Button>
        </AlertDescription>
      </Alert>
    )}
    {summaries.length > 0 && (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="plan-select" className="text-muted-foreground">
          Open plan
        </label>
        <select
          id="plan-select"
          className="border-input bg-control h-10 max-w-full rounded-xl border px-3"
          value={activeId ?? ""}
          onChange={(event) =>
            onSelect(Schema.decodeUnknownSync(MealPlanId)(event.target.value))
          }
        >
          <option value="">Choose a plan</option>
          {summaries.map((item) => (
            <option key={item.planId} value={item.planId}>
              {dateLabel(item.startDate, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}{" "}
              · {item.weeks} weeks · {summaryStateLabel(item.state)}
            </option>
          ))}
        </select>
      </div>
    )}
    {summaries.length === 0 && (
      <div className="bg-accent rounded-3xl p-7 md:p-10">
        <h2 className="font-display text-4xl">A week that fits everyone.</h2>
        <p className="mt-3 max-w-lg leading-7">
          Choose the meals your family manages in Food book, then start a draft.
          Missing meal choices stay visible as gaps.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            disabled={!hasManagedMeals || people.length === 0 || pending}
            onClick={onNew}
          >
            Create the first draft
          </Button>
          <Button variant="outline" render={<a href="/?area=food" />}>
            Set up Food book
          </Button>
        </div>
      </div>
    )}
    {activeId && detailPending && <Skeleton className="h-80" />}
    {activeId && detailError && (
      <Alert variant="destructive">
        <AlertTitle>Plan unavailable</AlertTitle>
        <AlertDescription>
          We couldn’t load this plan.{" "}
          <Button variant="link" onClick={onReadPlan}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )}
    {detailPlan && (
      <PlanView
        key={`${detailPlan.planId}:${detailPlan.revision}:${detailPlan._tag}`}
        plan={detailPlan}
        snapshot={snapshot}
        people={people}
        onChange={onChange}
        onDecision={onDecision}
        onRefreshInputs={onRefreshInputs}
        pending={pending}
      />
    )}
    {detailPlan && detailPlan._tag !== "Approved" && (
      <section className="bg-accent/50 rounded-3xl p-5 md:p-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs tracking-widest uppercase">
              Plan together
            </p>
            <h2 className="font-display mt-2 text-3xl md:text-4xl">
              Ask for a full week.
            </h2>
            <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
              The assistant can propose all managed meals from your confirmed
              family context. Review its exact proposed changes before
              accepting.
            </p>
          </div>
          <Button variant="outline" onClick={onRefreshPlan}>
            <RefreshCwIcon data-icon="inline-start" />
            Refresh plan
          </Button>
        </div>
        <FamilyConversationPanel
          scope={scope}
          planId={detailPlan.planId}
          onPlanProposalReview={onProposalReview}
          onPlanChangeCommitted={async () => {
            await onPlanCommitted(detailPlan.planId);
          }}
        />
      </section>
    )}
  </>
);
const PlanOverlays = ({
  newPlanOpen,
  setNewPlanOpen,
  startDate,
  setStartDate,
  weeks,
  setWeeks,
  createPlan,
  pending,
  peopleCount,
  hasManagedMeals,
  proposalReview,
  setProposalReview,
  plan,
  snapshot,
  people,
}: {
  readonly newPlanOpen: boolean;
  readonly setNewPlanOpen: (open: boolean) => void;
  readonly startDate: string;
  readonly setStartDate: (value: string) => void;
  readonly weeks: number;
  readonly setWeeks: (value: number) => void;
  readonly createPlan: (event: React.FormEvent) => void;
  readonly pending: boolean;
  readonly peopleCount: number;
  readonly hasManagedMeals: boolean;
  readonly proposalReview: ProposalReviewState | null;
  readonly setProposalReview: (value: ProposalReviewState | null) => void;
  readonly plan: HouseholdMealPlanResponse | undefined;
  readonly snapshot: PlanningContentSnapshot | undefined;
  readonly people: readonly HouseholdPerson[];
}) => (
  <>
    <Overlay.Root
      open={newPlanOpen}
      onOpenChange={setNewPlanOpen}
      desktop="drawer"
    >
      <Overlay.Content data-theme="journey">
        <Overlay.Header>
          <Overlay.Title>Start a new plan</Overlay.Title>
          <Overlay.Description>
            Choose the period before reviewing a household draft.
          </Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          <form onSubmit={createPlan} className="flex flex-col gap-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="plan-start">Start date</FieldLabel>
                <Input
                  id="plan-start"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="plan-weeks">Weeks</FieldLabel>
                <Input
                  id="plan-weeks"
                  type="number"
                  min={1}
                  max={12}
                  value={weeks}
                  onChange={(event) => setWeeks(Number(event.target.value))}
                  required
                />
                <FieldDescription>
                  One to twelve weeks. Missing meals remain visible as gaps.
                </FieldDescription>
              </Field>
            </FieldGroup>
            <Button
              type="submit"
              disabled={pending || peopleCount === 0 || !hasManagedMeals}
            >
              Create draft
            </Button>
          </form>
        </Overlay.Body>
      </Overlay.Content>
    </Overlay.Root>
    <Overlay.Root
      open={proposalReview !== null}
      onOpenChange={(open) => {
        if (!open) {
          setProposalReview(null);
        }
      }}
      desktop="drawer"
    >
      <Overlay.Content data-theme="journey">
        <Overlay.Header>
          <Overlay.Title className="sr-only">
            Review assistant plan proposal
          </Overlay.Title>
          <Overlay.Description className="sr-only">
            Compare every proposed meal before applying the change.
          </Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          {proposalReview && plan && snapshot && (
            <PlanProposalReviewSheet
              block={proposalReview.block}
              actions={proposalReview.actions}
              plan={plan}
              snapshot={snapshot}
              people={people}
              onClose={() => setProposalReview(null)}
            />
          )}
        </Overlay.Body>
      </Overlay.Content>
    </Overlay.Root>
  </>
);

const PlanningHeader = ({
  hasPlan,
  pending,
  onNew,
}: {
  readonly hasPlan: boolean;
  readonly pending: boolean;
  readonly onNew: () => void;
}) =>
  hasPlan ? (
    <div className="flex items-center justify-between gap-4">
      <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
        Our weeks
      </p>
      <Button variant="outline" size="sm" disabled={pending} onClick={onNew}>
        <CalendarDaysIcon data-icon="inline-start" />
        New plan
      </Button>
    </div>
  ) : (
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Our weeks
        </p>
        <h1
          id="meal-planning-title"
          className="font-display mt-3 text-5xl leading-none md:text-7xl"
        >
          The family edit.
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl leading-7">
          Breakfast, lunch, dinner and snacks for the people at your table, with
          their differences kept visible.
        </p>
      </div>
      <Button variant="outline" disabled={pending} onClick={onNew}>
        <CalendarDaysIcon data-icon="inline-start" />
        New plan
      </Button>
    </header>
  );

export const MealPlanningPage = ({
  scope,
}: {
  readonly scope: DisplayedIdentity;
}) => {
  const runtime = useApiRuntime();
  const client = useQueryClient();
  const list = useQuery(mealPlanListQueryOptions(runtime, scope));
  const content = useQuery(foodBookQueryOptions(runtime, scope));
  const roster = useQuery(
    familyRosterQueryOptions(runtime, scope.userId, scope.organizationId)
  );
  const [selectedId, setSelectedId] = useState<MealPlanId | undefined>();
  const activeId = selectedId ?? list.data?.[0]?.planId;
  const detail = useQuery(mealPlanDetailQueryOptions(runtime, scope, activeId));
  const [startDate, setStartDate] = useState(isoToday);
  const [weeks, setWeeks] = useState(2);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [proposalReview, setProposalReview] = useState<{
    readonly block: Parameters<PlanProposalReview>[0];
    readonly actions: PlanProposalReviewActions;
  } | null>(null);
  const [retained, setRetained] = useState<PendingRequest | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const onSuccess = async (plan: HouseholdMealPlanResponse) => {
    client.setQueryData([...mealPlanKey(scope), "detail", plan.planId], plan);
    setSelectedId(plan.planId);
    setNewPlanOpen(false);
    setRetained(null);
    setRequestError(null);
    await Promise.all([
      client.invalidateQueries({ queryKey: [...mealPlanKey(scope), "list"] }),
      invalidatePlanningContent(client, scope),
    ]);
  };
  const onFailure = (error: Error) => {
    const reason = rejectionMessage(error);
    if (reason !== null) {
      setRetained(null);
      setRequestError(reason);
    }
  };
  const create = useMutation({
    ...createMealPlanMutationOptions(runtime, scope),
    onError: onFailure,
    onSuccess,
  });
  const change = useMutation({
    ...changeMealPlanMutationOptions(runtime, scope),
    onError: onFailure,
    onSuccess,
  });
  const approve = useMutation({
    ...decideMealPlanMutationOptions(runtime, scope, "approve"),
    onError: onFailure,
    onSuccess,
  });
  const proposeRevision = useMutation({
    ...decideMealPlanMutationOptions(runtime, scope, "proposeRevision"),
    onError: onFailure,
    onSuccess,
  });
  const acceptRevision = useMutation({
    ...decideMealPlanMutationOptions(runtime, scope, "acceptRevision"),
    onError: onFailure,
    onSuccess,
  });
  const rejectRevision = useMutation({
    ...decideMealPlanMutationOptions(runtime, scope, "rejectRevision"),
    onError: onFailure,
    onSuccess,
  });
  const pending = [
    create,
    change,
    approve,
    proposeRevision,
    acceptRevision,
    rejectRevision,
  ].some((mutation) => mutation.isPending);
  const run = (request: PendingRequest) => {
    if (retained !== null && retained !== request) {
      return;
    }
    setRetained(request);
    setRequestError(null);
    switch (request.kind) {
      case "create": {
        create.mutate(request.payload);
        return;
      }
      case "change": {
        change.mutate({ payload: request.payload, planId: request.planId });
        return;
      }
      case "approve": {
        approve.mutate({ payload: request.payload, planId: request.planId });
        return;
      }
      case "proposeRevision": {
        proposeRevision.mutate({
          payload: request.payload,
          planId: request.planId,
        });
        return;
      }
      case "acceptRevision": {
        acceptRevision.mutate({
          payload: request.payload,
          planId: request.planId,
        });
        return;
      }
      case "rejectRevision": {
        rejectRevision.mutate({
          payload: request.payload,
          planId: request.planId,
        });
        break;
      }
      default: {
        throw new Error("Unsupported plan request.");
      }
    }
  };
  const createPlan = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = Schema.decodeUnknownSync(CreateMealPlanPayload)({
        requestKey: Schema.decodeUnknownSync(MealPlanRequestKey)(
          crypto.randomUUID()
        ),
        startDate: Schema.decodeUnknownSync(MealPlanDate)(startDate),
        weeks: Schema.decodeUnknownSync(MealPlanWeeks)(weeks),
      });
      run({ kind: "create", payload });
    } catch {
      setRequestError(
        "Choose a real start date and between one and twelve weeks."
      );
    }
  };
  const changeCoverage = (
    entry: MealPlanCoverage,
    resolution: MealPlanResolution,
    reason: string,
    replaceShared: boolean
  ) => {
    const plan = detail.data;
    if (!plan) {
      return;
    }
    const old = entry.resolution;
    const changeCommand =
      replaceShared &&
      old._tag === "MealOption" &&
      resolution._tag === "MealOption"
        ? {
            _tag: "ReplaceMealEvent" as const,
            eventId: old.eventId,
            option: resolution.option,
            rationale: reason,
          }
        : {
            _tag: "SetCoverage" as const,
            requirement: entry.requirement,
            resolution,
          };
    const payload: ChangeMealPlanPayload = {
      change: changeCommand,
      expectedRevision: plan.revision,
      mutationId: Schema.decodeUnknownSync(MealPlanMutationId)(
        crypto.randomUUID()
      ),
      reason,
    };
    run({ kind: "change", payload, planId: plan.planId });
  };
  const refreshInputs = () => {
    const plan = detail.data;
    if (!plan || plan._tag === "Approved") {
      return;
    }
    const payload: ChangeMealPlanPayload = {
      change: { _tag: "RefreshInputs" },
      expectedRevision: plan.revision,
      mutationId: Schema.decodeUnknownSync(MealPlanMutationId)(
        crypto.randomUUID()
      ),
      reason: "Refresh the plan against current family and Food book inputs",
    };
    run({ kind: "change", payload, planId: plan.planId });
  };
  const decision = (kind: PlanDecision, reason: string) => {
    const plan = detail.data;
    if (!plan) {
      return;
    }
    const payload: DecideMealPlanPayload = {
      expectedRevision: plan.revision,
      mutationId: Schema.decodeUnknownSync(MealPlanMutationId)(
        crypto.randomUUID()
      ),
      reason,
    };
    run({ kind, payload, planId: plan.planId });
  };
  const reconcile = async () => {
    await Promise.all([list.refetch(), detail.refetch(), content.refetch()]);
    setRequestError(
      "Check the latest plan before sending another change. Your original request is still available to retry."
    );
  };
  const failure =
    [
      create.error,
      change.error,
      approve.error,
      proposeRevision.error,
      acceptRevision.error,
      rejectRevision.error,
    ].find((item) => item !== null) ?? null;
  const rejectedReason = failure ? rejectionMessage(failure) : null;
  const people = (roster.data?.people ?? []).filter(
    (person) => person.lifecycle === "active"
  );
  const hasManagedMeals =
    content.data?.managedOccasions.some(
      (occasion) => occasion.state === "managed"
    ) ?? false;
  return (
    <section
      aria-labelledby="meal-planning-title"
      className="mx-auto flex w-full max-w-7xl flex-col gap-5 py-5 md:gap-8 md:py-8"
    >
      <PlanningHeader
        hasPlan={detail.data !== undefined}
        pending={pending || retained !== null}
        onNew={() => setNewPlanOpen(true)}
      />
      <PlanRequestStatus
        requestError={requestError}
        retained={retained}
        failure={failure}
        rejectedReason={rejectedReason}
        pending={pending}
        loading={list.isPending || content.isPending || roster.isPending}
        loadError={list.isError || content.isError || roster.isError}
        onReconcile={reconcile}
        onRetry={run}
        onReload={async () => {
          await Promise.all([
            list.refetch(),
            content.refetch(),
            roster.refetch(),
          ]);
        }}
      />
      {list.data && content.data && roster.data && (
        <PlanLoadedContent
          scope={scope}
          summaries={list.data}
          snapshot={content.data}
          people={people}
          hasManagedMeals={hasManagedMeals}
          activeId={activeId}
          detailPlan={detail.data}
          detailPending={detail.isPending}
          detailError={detail.isError}
          pending={pending || retained !== null}
          onNew={() => setNewPlanOpen(true)}
          onSelect={setSelectedId}
          onReadPlan={async () => {
            await detail.refetch();
          }}
          onChange={changeCoverage}
          onDecision={decision}
          onRefreshInputs={refreshInputs}
          onProposalReview={(block, actions) =>
            setProposalReview({ actions, block })
          }
          onPlanCommitted={async (planId) => {
            await Promise.all([
              client.invalidateQueries({
                queryKey: [...mealPlanKey(scope), "detail", planId],
              }),
              client.invalidateQueries({
                queryKey: [...mealPlanKey(scope), "list"],
              }),
              invalidatePlanningContent(client, scope),
            ]);
          }}
          onRefreshPlan={async () => {
            await Promise.all([detail.refetch(), content.refetch()]);
          }}
        />
      )}
      <PlanOverlays
        newPlanOpen={newPlanOpen}
        setNewPlanOpen={setNewPlanOpen}
        startDate={startDate}
        setStartDate={setStartDate}
        weeks={weeks}
        setWeeks={setWeeks}
        createPlan={createPlan}
        pending={pending || retained !== null}
        peopleCount={people.length}
        hasManagedMeals={hasManagedMeals}
        proposalReview={proposalReview}
        setProposalReview={setProposalReview}
        plan={detail.data}
        snapshot={content.data}
        people={people}
      />
    </section>
  );
};
