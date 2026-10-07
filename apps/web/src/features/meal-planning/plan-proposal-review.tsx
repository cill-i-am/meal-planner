import type {
  HouseholdMealPlanResponse,
  MealPlanChange,
  MealPlanCoverage,
  MealPlanVersion,
  PlanningContentSnapshot,
} from "@meal-planner/household-api";
import { useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import type {
  PlanProposalReview,
  PlanProposalReviewActions,
} from "../agent-conversations/index.js";
import { coverageKey, dateLabel, resolutionLabel } from "./plan-projection.js";

type PlanBlock = Parameters<PlanProposalReview>[0];
interface PlanPerson {
  readonly id: string;
  readonly displayName: string;
}
interface PlanProjection {
  readonly coverage: readonly MealPlanCoverage[];
  readonly cookEvents: MealPlanVersion["cookEvents"];
}

const personName = (people: readonly PlanPerson[], id: string) =>
  people.find((person) => person.id === id)?.displayName ?? "Family member";
const occasionName = (snapshot: PlanningContentSnapshot, id: string) =>
  snapshot.managedOccasions.find((occasion) => occasion.occasionId === id)
    ?.label ?? "Meal";
const removedOutputIds = (
  before: MealPlanVersion["cookEvents"],
  after: MealPlanVersion["cookEvents"]
) =>
  new Set(
    before
      .flatMap((event) => event.outputs.map((output) => output.outputId))
      .filter(
        (id) =>
          !after.some((event) =>
            event.outputs.some((output) => output.outputId === id)
          )
      )
  );
const repairRemovedOutputs = (
  coverage: readonly MealPlanCoverage[],
  removed: ReadonlySet<string>
): readonly MealPlanCoverage[] =>
  coverage.map((entry) =>
    entry.resolution._tag === "Prepared" &&
    removed.has(entry.resolution.outputId)
      ? {
          ...entry,
          resolution: {
            _tag: "Gap",
            rationale:
              "The prepared food source was removed. Choose another meal.",
            reason: "dependent_output_removed",
          },
        }
      : entry
  );

const projectChange = (
  version: MealPlanVersion,
  change: MealPlanChange
): PlanProjection | null => {
  switch (change._tag) {
    case "ReplaceDraftPlan": {
      return { cookEvents: change.cookEvents, coverage: change.coverage };
    }
    case "SetCoverage": {
      const key = coverageKey(change);
      if (!version.coverage.some((entry) => coverageKey(entry) === key)) {
        return null;
      }
      return {
        cookEvents: version.cookEvents,
        coverage: version.coverage.map((entry) =>
          coverageKey(entry) === key
            ? { requirement: change.requirement, resolution: change.resolution }
            : entry
        ),
      };
    }
    case "ReplaceMealEvent": {
      if (
        !version.coverage.some(
          (entry) =>
            entry.resolution._tag === "MealOption" &&
            entry.resolution.eventId === change.eventId
        )
      ) {
        return null;
      }
      const cookEvents = version.cookEvents.filter(
        (event) => event.eventId !== change.eventId
      );
      const coverage = version.coverage.map((entry): MealPlanCoverage =>
        entry.resolution._tag === "MealOption" &&
        entry.resolution.eventId === change.eventId
          ? {
              ...entry,
              resolution: {
                ...entry.resolution,
                option: change.option,
                rationale: change.rationale,
              },
            }
          : entry
      );
      return {
        cookEvents,
        coverage: repairRemovedOutputs(
          coverage,
          removedOutputIds(version.cookEvents, cookEvents)
        ),
      };
    }
    case "SetCookEvent": {
      const cookEvents = [
        ...version.cookEvents.filter(
          (event) => event.eventId !== change.event.eventId
        ),
        change.event,
      ];
      return {
        cookEvents,
        coverage: repairRemovedOutputs(
          version.coverage,
          removedOutputIds(version.cookEvents, cookEvents)
        ),
      };
    }
    case "RemoveCookEvent": {
      if (
        !version.cookEvents.some((event) => event.eventId === change.eventId)
      ) {
        return null;
      }
      const cookEvents = version.cookEvents.filter(
        (event) => event.eventId !== change.eventId
      );
      return {
        cookEvents,
        coverage: repairRemovedOutputs(
          version.coverage,
          removedOutputIds(version.cookEvents, cookEvents)
        ),
      };
    }
    case "RefreshInputs": {
      return null;
    }
    default: {
      return null;
    }
  }
};

const CookEventsPreview = ({
  before,
  after,
  snapshot,
}: {
  readonly before: MealPlanVersion["cookEvents"];
  readonly after: MealPlanVersion["cookEvents"];
  readonly snapshot: PlanningContentSnapshot;
}) => {
  const label = (optionId: string, optionVersion: number) =>
    snapshot.options.find(
      (option) =>
        option.optionId === optionId && option.optionVersion === optionVersion
    )?.label ?? "Saved food unavailable";
  const line = (event: MealPlanVersion["cookEvents"][number]) =>
    `${dateLabel(event.date, { day: "numeric", month: "short", weekday: "short" })} · ${label(event.option.optionId, event.option.optionVersion)} · ${event.batchCount} ${event.batchCount === 1 ? "batch" : "batches"} · ${event.outputs.map((output) => `${output.quantity.amount} ${output.quantity.unit} prepared`).join(", ") || "no prepared output"}`;
  return (
    <section>
      <h3 className="font-display text-2xl">Cooking and prepared output.</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="border-border rounded-2xl border p-4">
          <p className="text-muted-foreground text-xs tracking-widest uppercase">
            Current
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {before.length ? (
              before.map((event) => <li key={event.eventId}>{line(event)}</li>)
            ) : (
              <li>No cook events</li>
            )}
          </ul>
        </div>
        <div className="bg-accent rounded-2xl p-4">
          <p className="text-xs tracking-widest uppercase">Proposed</p>
          <ul className="mt-3 space-y-2 text-sm">
            {after.length ? (
              after.map((event) => <li key={event.eventId}>{line(event)}</li>)
            ) : (
              <li>No cook events</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
};

const PlanCoverageDay = ({
  date,
  coverage,
  currentVersion,
  proposedCookEvents,
  people,
  snapshot,
}: {
  readonly date: string;
  readonly coverage: readonly MealPlanCoverage[];
  readonly currentVersion: MealPlanVersion;
  readonly proposedCookEvents: MealPlanVersion["cookEvents"];
  readonly people: readonly PlanPerson[];
  readonly snapshot: PlanningContentSnapshot;
}) => {
  const previous = new Map(
    currentVersion.coverage.map((entry) => [coverageKey(entry), entry])
  );
  const priorSnapshot = {
    ...snapshot,
    options: currentVersion.pins.contentSnapshots,
  };
  return (
    <section className="border-border border-b py-5 last:border-b-0">
      <h3 className="font-display text-2xl">
        {dateLabel(date, { day: "numeric", month: "long", weekday: "long" })}
      </h3>
      <ul className="divide-border mt-3 divide-y">
        {coverage
          .filter((entry) => entry.requirement.date === date)
          .map((entry) => {
            const prior = previous.get(coverageKey(entry));
            const changed =
              prior === undefined ||
              JSON.stringify(prior.resolution) !==
                JSON.stringify(entry.resolution);
            const quantity =
              entry.resolution._tag === "MealOption" ||
              entry.resolution._tag === "Prepared"
                ? entry.resolution.quantity
                : null;
            return (
              <li
                key={coverageKey(entry)}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-muted-foreground text-xs">
                    {occasionName(snapshot, entry.requirement.occasion)} ·{" "}
                    {personName(people, entry.requirement.personId)}
                  </p>
                  {changed && (
                    <p className="text-muted-foreground mt-1 text-sm">
                      Was:{" "}
                      {prior
                        ? resolutionLabel(
                            prior.resolution,
                            priorSnapshot,
                            currentVersion.cookEvents
                          )
                        : "Unplanned"}
                    </p>
                  )}
                  <p className="mt-1 font-medium">
                    Now:{" "}
                    {resolutionLabel(
                      entry.resolution,
                      snapshot,
                      proposedCookEvents
                    )}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {entry.resolution.rationale}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {quantity && (
                    <span className="text-xs tabular-nums">
                      {quantity.amount} {quantity.unit}
                    </span>
                  )}
                  {changed && <Badge variant="secondary">Changed</Badge>}
                </div>
              </li>
            );
          })}
      </ul>
    </section>
  );
};
const PlanCoveragePreview = ({
  projection,
  currentVersion,
  people,
  snapshot,
}: {
  readonly projection: PlanProjection;
  readonly currentVersion: MealPlanVersion;
  readonly people: readonly PlanPerson[];
  readonly snapshot: PlanningContentSnapshot;
}) => {
  const dates = [
    ...new Set(projection.coverage.map((entry) => entry.requirement.date)),
  ].toSorted();
  return (
    <>
      <div
        className="border-border max-h-[55dvh] overflow-y-auto rounded-2xl border px-4 md:px-6"
        aria-label="Complete proposed meal coverage"
      >
        {dates.map((date) => (
          <PlanCoverageDay
            key={date}
            date={date}
            coverage={projection.coverage}
            currentVersion={currentVersion}
            proposedCookEvents={projection.cookEvents}
            people={people}
            snapshot={snapshot}
          />
        ))}
      </div>
      <CookEventsPreview
        before={currentVersion.cookEvents}
        after={projection.cookEvents}
        snapshot={snapshot}
      />
    </>
  );
};

const canConfirmProposal = (
  block: PlanBlock,
  plan: HouseholdMealPlanResponse,
  projection: PlanProjection | null,
  stale: boolean,
  unresolvedCount: number,
  missingCount: number
) =>
  !stale &&
  plan._tag !== "Approved" &&
  projection !== null &&
  unresolvedCount === 0 &&
  missingCount === 0 &&
  block.status === "proposed";
const ProposalIssues = ({
  stale,
  approved,
  previewMissing,
  gaps,
  unresolvedAllocations,
  missingOptions,
}: {
  readonly stale: boolean;
  readonly approved: boolean;
  readonly previewMissing: boolean;
  readonly gaps: number;
  readonly unresolvedAllocations: number;
  readonly missingOptions: number;
}) => (
  <>
    {stale && (
      <Alert variant="destructive">
        <AlertTitle>This proposal is out of date</AlertTitle>
        <AlertDescription>
          The plan changed after the assistant made this suggestion. Refresh it
          and ask for a new proposal.
        </AlertDescription>
      </Alert>
    )}
    {approved && (
      <Alert>
        <AlertTitle>Start a revision first</AlertTitle>
        <AlertDescription>
          The approved plan stays in place until a proposed revision is
          reviewed.
        </AlertDescription>
      </Alert>
    )}
    {previewMissing && (
      <Alert>
        <AlertTitle>Change unavailable</AlertTitle>
        <AlertDescription>
          This proposal no longer matches the selected plan or cannot be
          previewed. Ask for a fresh suggestion.
        </AlertDescription>
      </Alert>
    )}
    {gaps > 0 && (
      <Alert>
        <AlertTitle>Open meals remain</AlertTitle>
        <AlertDescription>
          {gaps} managed meals still need a choice before approval. They remain
          visible below.
        </AlertDescription>
      </Alert>
    )}
    {unresolvedAllocations > 0 && (
      <Alert>
        <AlertTitle>Portions need amounts</AlertTitle>
        <AlertDescription>
          {unresolvedAllocations} meals have no known person allocation. Review
          amounts before accepting this proposal.
        </AlertDescription>
      </Alert>
    )}
    {missingOptions > 0 && (
      <Alert>
        <AlertTitle>Saved food changed</AlertTitle>
        <AlertDescription>
          {missingOptions} choices no longer match a saved option version.
        </AlertDescription>
      </Alert>
    )}
  </>
);

export const PlanProposalReviewSheet = ({
  block,
  actions,
  plan,
  snapshot,
  people,
  onClose,
}: {
  readonly block: PlanBlock;
  readonly actions: PlanProposalReviewActions;
  readonly plan: HouseholdMealPlanResponse;
  readonly snapshot: PlanningContentSnapshot;
  readonly people: readonly PlanPerson[];
  readonly onClose: () => void;
}) => {
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const currentVersion = plan._tag === "Approved" ? plan.active : plan.proposed;
  const projection = projectChange(currentVersion, block.change);
  const stale =
    block.planId !== plan.planId || block.expectedRevision !== plan.revision;
  const gaps =
    projection?.coverage.filter((entry) => entry.resolution._tag === "Gap") ??
    [];
  const unresolvedAllocations =
    projection?.coverage.filter(
      (entry) =>
        entry.resolution._tag === "MealOption" &&
        entry.resolution.option.kind !== "external" &&
        entry.resolution.quantity === null
    ) ?? [];
  const missingOptions =
    projection?.coverage.filter((entry) => {
      const { resolution } = entry;
      return (
        resolution._tag === "MealOption" &&
        !snapshot.options.some(
          (option) =>
            option.optionId === resolution.option.optionId &&
            option.optionVersion === resolution.option.optionVersion
        )
      );
    }) ?? [];
  const canConfirm = canConfirmProposal(
    block,
    plan,
    projection,
    stale,
    unresolvedAllocations.length,
    missingOptions.length
  );
  const act = async (action: "confirm" | "dismiss") => {
    setPending(true);
    setActionError(null);
    try {
      await actions[action]();
      onClose();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The review result is unknown. Refresh the plan before trying again."
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          Assistant proposal · review required
        </p>
        <h2 className="font-display mt-2 text-4xl">Review the family edit.</h2>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          {block.explanation}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {projection?.coverage.length ?? 0} person meals
        </Badge>
        <Badge variant="secondary">
          {projection?.cookEvents.length ?? 0} cook events
        </Badge>
        <Badge variant="secondary">{gaps.length} open meals</Badge>
      </div>
      <ProposalIssues
        stale={stale}
        approved={plan._tag === "Approved"}
        previewMissing={projection === null}
        gaps={gaps.length}
        unresolvedAllocations={unresolvedAllocations.length}
        missingOptions={missingOptions.length}
      />
      {projection && (
        <PlanCoveragePreview
          projection={projection}
          currentVersion={currentVersion}
          people={people}
          snapshot={snapshot}
        />
      )}
      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Review not confirmed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}
      <div className="border-border flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button
          variant="ghost"
          disabled={pending}
          onClick={async () => {
            await act("dismiss");
          }}
        >
          Dismiss suggestion
        </Button>
        <Button
          disabled={!canConfirm || pending}
          onClick={async () => {
            await act("confirm");
          }}
        >
          {pending ? "Confirming…" : "Use this proposal"}
        </Button>
      </div>
    </div>
  );
};
