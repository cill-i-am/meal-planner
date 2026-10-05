import type { PlanningSetupCommand } from "@meal-planner/agent-conversations-api";
import type { PlanningContentSnapshot } from "@meal-planner/household-api";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import type {
  PlanningContentProposalReview,
  PlanProposalReviewActions,
} from "../agent-conversations/index.js";
import { useApiRuntime } from "../api-client/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import { familyRosterQueryOptions } from "../family/index.js";
import { foodBookQueryOptions } from "./operations.js";

type ProposalBlock = Parameters<PlanningContentProposalReview>[0];
interface Person {
  readonly id: string;
  readonly displayName: string;
}
const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const daysLabel = (days: readonly number[]) =>
  days.map((day) => weekdays[day] ?? "Day").join(", ");
const personName = (people: readonly Person[], id: string) =>
  people.find((person) => person.id === id)?.displayName ?? "Family member";
const quantityLabel = (
  quantity:
    | { readonly _tag: "Known"; readonly amount: number; readonly unit: string }
    | { readonly _tag: "Unresolved"; readonly sourceText: string }
) =>
  quantity._tag === "Known"
    ? `${quantity.amount} ${quantity.unit}`
    : `Needs review: ${quantity.sourceText}`;

const Comparison = ({
  current,
  proposed,
}: {
  readonly current: readonly string[];
  readonly proposed: readonly string[];
}) => (
  <div className="mt-5 grid gap-4 sm:grid-cols-2">
    <div className="border-border rounded-2xl border p-4">
      <p className="text-muted-foreground text-xs tracking-widest uppercase">
        Current
      </p>
      {current.length ? (
        <ul className="mt-3 space-y-2 text-sm">
          {current.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">Nothing saved yet</p>
      )}
    </div>
    <div className="bg-accent rounded-2xl p-4">
      <p className="text-xs tracking-widest uppercase">Proposed</p>
      {proposed.length ? (
        <ul className="mt-3 space-y-2 text-sm">
          {proposed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm">None</p>
      )}
    </div>
  </div>
);
const occasionLine = (
  entry: PlanningContentSnapshot["managedOccasions"][number]
) => `${entry.label} · ${entry.state} · ${daysLabel(entry.weekdays)}`;
const availabilityLine = (
  entry: PlanningContentSnapshot["availability"][number],
  snapshot: PlanningContentSnapshot
) =>
  `${snapshot.managedOccasions.find((item) => item.occasionId === entry.occasionId)?.label ?? "Meal"} · ${daysLabel(entry.weekdays)} · ${entry.location} · ${entry.preparationWindowMinutes} minutes · hands-off start ${entry.handsOffStart}`;
const timeLabel = (
  time:
    | { readonly _tag: "Known"; readonly minutes: number }
    | { readonly _tag: "Unknown" }
) => (time._tag === "Known" ? `${time.minutes} minutes` : "needs review");
const setupKindLabel = (
  kind: "assembled" | "packaged" | "external" | "recipe"
) => {
  switch (kind) {
    case "assembled": {
      return "Assembled meal";
    }
    case "packaged": {
      return "Packaged food";
    }
    case "external": {
      return "Eating out";
    }
    case "recipe": {
      return "Recipe";
    }
    default: {
      return "Saved meal";
    }
  }
};
const setupQuantity = (
  option: Extract<PlanningSetupCommand, { _tag: "PutOption" }>["value"]
) => {
  if (option.kind === "assembled") {
    return option.yield;
  }
  if (option.kind === "packaged") {
    return option.quantity;
  }
  return null;
};
const CommandPreview = ({
  command,
  people,
  snapshot,
}: {
  readonly command: PlanningSetupCommand;
  readonly people: readonly Person[];
  readonly snapshot: PlanningContentSnapshot;
}) => {
  switch (command._tag) {
    case "SetPersonManagedOccasions": {
      const current = snapshot.managedOccasions
        .filter((entry) => entry.personId === command.personId)
        .map(occasionLine);
      return (
        <section>
          <h3 className="font-display text-3xl">
            Meals for {personName(people, command.personId)}
          </h3>
          <p className="text-muted-foreground mt-2 text-sm">
            This replaces this person’s saved meal schedule.
          </p>
          <Comparison
            current={current}
            proposed={command.entries.map(occasionLine)}
          />
        </section>
      );
    }
    case "SetPersonAvailability": {
      const current = snapshot.availability
        .filter((entry) => entry.personId === command.personId)
        .map((entry) => availabilityLine(entry, snapshot));
      return (
        <section>
          <h3 className="font-display text-3xl">
            Availability for {personName(people, command.personId)}
          </h3>
          <p className="text-muted-foreground mt-2 text-sm">
            This replaces this person’s saved preparation availability.
          </p>
          <Comparison
            current={current}
            proposed={command.entries.map((entry) =>
              availabilityLine(entry, snapshot)
            )}
          />
        </section>
      );
    }
    case "SetCookingCapacity": {
      const current = snapshot.cookingCapacity;
      return (
        <section>
          <h3 className="font-display text-3xl">Cooking capacity</h3>
          <Comparison
            current={[
              `${current.maximumSubstantialCookEventsPerWeek} substantial cooks a week`,
              `Equipment: ${current.availableEquipment.join(", ") || "none confirmed"}`,
            ]}
            proposed={[
              `${command.value.maximumSubstantialCookEventsPerWeek} substantial cooks a week`,
              `Equipment: ${command.value.availableEquipment.join(", ") || "none confirmed"}`,
            ]}
          />
        </section>
      );
    }
    case "PutOption": {
      const option = command.value;
      const current = snapshot.options.find(
        (item) => item.optionId === option.optionId
      );
      const quantity = setupQuantity(option);
      return (
        <section>
          <h3 className="font-display text-3xl">{option.label}</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            {current
              ? `Updates saved version ${current.optionVersion} to ${option.optionVersion}.`
              : "Adds a new saved meal."}{" "}
            {setupKindLabel(option.kind)}.
          </p>
          {quantity && (
            <p className="mt-4">Amount: {quantityLabel(quantity)}</p>
          )}
          {option.kind !== "external" && (
            <>
              <p className="mt-3 text-sm">
                Preparation: {option.preparation.attention} attention,{" "}
                {option.preparation.cleanup} cleanup,{" "}
                {option.preparation.startRequirement.replaceAll("_", " ")}{" "}
                start.
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                Elapsed time: {timeLabel(option.preparation.elapsedTime)} ·
                hands-on time: {timeLabel(option.preparation.handsOnTime)}.
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                Equipment:{" "}
                {option.preparation.requiredEquipment.join(", ") ||
                  "none listed"}
                . Substantial cook event:{" "}
                {option.preparation.substantialCookEvent}.
              </p>
            </>
          )}
          {option.kind === "assembled" && (
            <ul className="divide-border mt-4 divide-y">
              {option.components.map((part, index) => (
                <li key={`${part.name}:${index}`} className="py-2 text-sm">
                  {part.name} · {quantityLabel(part.quantity)}
                </li>
              ))}
            </ul>
          )}
          <Alert className="mt-5">
            <AlertTitle>Review still needed</AlertTitle>
            <AlertDescription>
              Saving this food does not confirm person suitability, safety,
              portions or unresolved shopping amounts. Review those details
              before plan approval.
            </AlertDescription>
          </Alert>
        </section>
      );
    }
    case "PutFallback": {
      const choice = snapshot.options.find(
        (item) => item.optionId === command.value.optionRef.optionId
      );
      return (
        <section>
          <h3 className="font-display text-3xl">
            Backup for {personName(people, command.value.personId)}
          </h3>
          <p className="mt-3">
            {choice?.label ?? "Saved food needs review"} · priority{" "}
            {command.value.priority}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            {command.value.state} · locations{" "}
            {command.value.locations.join(", ") || "any"} ·{" "}
            {command.value.occasionIds
              .map(
                (id) =>
                  snapshot.managedOccasions.find(
                    (item) => item.occasionId === id
                  )?.label ?? "Meal"
              )
              .join(", ") || "any managed meal"}
          </p>
          <p className="text-muted-foreground mt-3 text-sm">
            Substitution policy: {command.value.substitutionPolicy}.
          </p>
        </section>
      );
    }
    default: {
      return null;
    }
  }
};

export const PlanningContentProposalReviewSheet = ({
  scope,
  block,
  actions,
  onClose,
}: {
  readonly scope: DisplayedIdentity;
  readonly block: ProposalBlock;
  readonly actions: PlanProposalReviewActions;
  readonly onClose: () => void;
}) => {
  const runtime = useApiRuntime();
  const content = useQuery(foodBookQueryOptions(runtime, scope));
  const roster = useQuery(
    familyRosterQueryOptions(runtime, scope.userId, scope.organizationId)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "confirm" | "dismiss") => {
    setPending(true);
    setError(null);
    try {
      await actions[action]();
      onClose();
    } catch {
      setError(
        "We could not confirm the result. Check the latest Food book before trying this exact proposal again."
      );
    } finally {
      setPending(false);
    }
  };
  if (content.isPending || roster.isPending) {
    return <Skeleton className="h-80 w-full" />;
  }
  if (content.isError || roster.isError || !content.data || !roster.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Review unavailable</AlertTitle>
        <AlertDescription>
          Load the latest Food book and family list before acting.{" "}
          <Button
            variant="link"
            onClick={async () => {
              await Promise.all([content.refetch(), roster.refetch()]);
            }}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const stale = content.data.configVersion !== block.expectedContentVersion;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          Assistant proposal · Food book
        </p>
        <h2 className="font-display mt-2 text-4xl">
          Review this family setup.
        </h2>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          {block.explanation}
        </p>
      </div>
      <CommandPreview
        command={block.command}
        people={roster.data.people}
        snapshot={content.data}
      />
      {stale && (
        <Alert variant="destructive">
          <AlertTitle>Food book changed</AlertTitle>
          <AlertDescription>
            This proposal used an earlier version. Ask the assistant for a fresh
            proposal from the current Food book.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Result needs checking</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || stale || block.status !== "proposed"}
          onClick={async () => {
            await act("confirm");
          }}
        >
          Save reviewed change
        </Button>
        <Button
          variant="outline"
          disabled={pending || block.status !== "proposed"}
          onClick={async () => {
            await act("dismiss");
          }}
        >
          Dismiss proposal
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          Close review
        </Button>
      </div>
    </div>
  );
};
