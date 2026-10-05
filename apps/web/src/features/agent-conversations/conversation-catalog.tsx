import { defineCatalog } from "@json-render/core";
import type { Spec } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import type {
  ConversationBlock,
  FoodAnswer,
  FoodTopic,
} from "@meal-planner/agent-conversations-api";
import type { PlanningContentSnapshot } from "@meal-planner/household-api";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import { z } from "zod";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import { Field, FieldLabel } from "../../components/ui/field.js";
import { useInteractionSound } from "../../hooks/use-interaction-sound.js";
import { cn } from "../../lib/utils.js";
import { describeRoutineChoice } from "../food-book/index.js";
import { describeProfileFact } from "../household-profiles/index.js";

const questionProps = z.strictObject({
  context: z.string(),
  foodTopic: z
    .enum(["pasta", "rice_bowls", "pizza", "tacos", "fish"])
    .nullable(),
  prompt: z.string(),
});
const proposalProps = z.strictObject({
  details: z.array(z.string()),
  explanation: z.string(),
  title: z.string(),
});
const recipeProps = z.strictObject({ recipeId: z.string() });

const foodImages: Record<
  FoodTopic,
  { readonly src: string; readonly label: string }
> = {
  fish: { label: "Fish", src: "/images/journey/fish.avif" },
  pasta: { label: "Pasta", src: "/images/journey/pesto-pasta.avif" },
  pizza: { label: "Pizza", src: "/images/journey/pizza.avif" },
  rice_bowls: { label: "Rice bowls", src: "/images/journey/rice-bowls.avif" },
  tacos: { label: "Tacos", src: "/images/journey/tacos.avif" },
};

export const conversationCatalog = defineCatalog(schema, {
  actions: {},
  components: {
    PersonFactProposal: {
      description:
        "A proposed person-specific food fact requiring confirmation.",
      props: proposalProps,
      slots: [],
    },
    PlanChangeProposal: {
      description: "A proposed change to a saved plan requiring confirmation.",
      props: proposalProps,
      slots: [],
    },
    PlanningContentProposal: {
      description: "A proposed meal setup change requiring confirmation.",
      props: proposalProps,
      slots: [],
    },
    Question: {
      description: "One food question tied to a person or family context.",
      props: questionProps,
      slots: [],
    },
    RecipeDetails: {
      description: "A link to inspect saved recipe details.",
      props: recipeProps,
      slots: [],
    },
    RosterProposal: {
      description: "A family roster draft that needs editable human review.",
      props: proposalProps,
      slots: [],
    },
    RoutineProposal: {
      description: "A proposed routine requiring confirmation.",
      props: proposalProps,
      slots: [],
    },
  },
});

type ProposalProps = z.infer<typeof proposalProps>;

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const personName = (
  personId: string,
  people: readonly { readonly id: string; readonly displayName: string }[]
) =>
  people.find((person) => person.id === personId)?.displayName ?? "This person";

const statusLabel = (
  status: ConversationBlock["status"],
  proposedLabel: string,
  acceptedLabel = "Confirmed"
) => {
  switch (status) {
    case "proposed": {
      return proposedLabel;
    }
    case "accepted": {
      return acceptedLabel;
    }
    case "answered": {
      return "Answered";
    }
    case "dismissed": {
      return "Dismissed";
    }
    case "pending": {
      return "Saving";
    }
    default: {
      return status satisfies never;
    }
  }
};

const ReviewStatusBadge = ({
  block,
  proposed,
  accepted,
}: {
  readonly block: ConversationBlock;
  readonly proposed: string;
  readonly accepted?: string;
}) => {
  const reducedMotion = useReducedMotion();
  return (
    <Badge variant="secondary" className="w-fit" aria-live="polite">
      <AnimatePresence initial={false} mode="wait">
        <m.span
          key={block.status}
          initial={reducedMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
          transition={{ duration: reducedMotion ? 0 : 0.16 }}
        >
          {statusLabel(block.status, proposed, accepted)}
        </m.span>
      </AnimatePresence>
    </Badge>
  );
};

const afterFactLabel = (
  block: Extract<ConversationBlock, { _tag: "PersonFactProposal" }>
) => {
  switch (block.change._tag) {
    case "Add":
    case "Replace": {
      return describeProfileFact(block.change.fact);
    }
    case "Remove": {
      return "Remove this fact";
    }
    case "Confirm": {
      return block.reviewedBefore === null
        ? "Fact needs a fresh review"
        : `${describeProfileFact(block.reviewedBefore)} · confirmed`;
    }
    default: {
      return block.change satisfies never;
    }
  }
};

const routineDetails = (
  block: Extract<ConversationBlock, { _tag: "RoutineProposal" }>,
  people: readonly { readonly id: string; readonly displayName: string }[],
  snapshot: PlanningContentSnapshot | null
) => {
  const { routine } = block;
  if (snapshot === null) {
    return ["Load current meal details before reviewing this routine."];
  }
  const occasion =
    snapshot.managedOccasions.find(
      (entry) => entry.occasionId === routine.occasionId
    )?.label ?? "Meal occasion needs review";
  const subject =
    routine.scope._tag === "Household"
      ? "Whole family"
      : personName(routine.scope.personId, people);
  return [
    `${subject} · ${occasion}`,
    routine.weekdays.map((day) => weekdays[day]).join(", "),
    `${routine.state === "active" ? "Active" : "Paused"} · ${describeRoutineChoice(routine.choice, snapshot)}`,
  ];
};

const canReviewRoutine = (
  block: Extract<ConversationBlock, { _tag: "RoutineProposal" }>,
  people: readonly { readonly id: string; readonly displayName: string }[],
  snapshot: PlanningContentSnapshot | null
) => {
  if (
    snapshot === null ||
    snapshot.configVersion !== block.expectedContentVersion
  ) {
    return false;
  }
  if (
    !snapshot.managedOccasions.some(
      (entry) => entry.occasionId === block.routine.occasionId
    )
  ) {
    return false;
  }
  const routineScope = block.routine.scope;
  if (
    routineScope._tag === "Person" &&
    !people.some((person) => person.id === routineScope.personId)
  ) {
    return false;
  }
  const refs = (() => {
    switch (block.routine.choice._tag) {
      case "Options": {
        return block.routine.choice.optionRefs;
      }
      case "External": {
        return [block.routine.choice.optionRef];
      }
      default: {
        return [];
      }
    }
  })();
  return refs.every((ref) =>
    snapshot.options.some(
      (option) =>
        option.optionId === ref.optionId &&
        option.optionVersion === ref.optionVersion
    )
  );
};

const specForBlock = (
  block: ConversationBlock,
  people: readonly { readonly id: string; readonly displayName: string }[],
  planningContent: PlanningContentSnapshot | null
) => {
  const props = (() => {
    switch (block._tag) {
      case "Question": {
        return {
          context:
            block.targetPersonId === null
              ? "A question for the family"
              : `A question about ${personName(block.targetPersonId, people)}`,
          foodTopic: block.foodTopic,
          prompt: block.prompt,
        };
      }
      case "RosterProposal": {
        return {
          details: [
            `Creator: ${block.creatorName}`,
            ...block.people.map(
              (person) =>
                `${person.displayName} · ${person.kind === "dependant" ? "managed child" : "adult"}`
            ),
          ],
          explanation:
            "Review the names and people before creating your family.",
          title: `${block.familyName} · family draft`,
        };
      }
      case "PersonFactProposal": {
        return {
          details: [
            `Before: ${block.reviewedBefore === null ? "No recorded fact" : describeProfileFact(block.reviewedBefore)}`,
            `After: ${afterFactLabel(block)}`,
            block.requiresSafetyConfirmation
              ? "This changes safety information. Missing information never means no restrictions."
              : "Only the confirmed result becomes a shared food fact.",
          ],
          explanation: block.explanation,
          title: people.some((person) => person.id === block.personId)
            ? `A food fact for ${personName(block.personId, people)}`
            : "A food fact awaiting a family member",
        };
      }
      case "RoutineProposal": {
        return {
          details: routineDetails(block, people, planningContent),
          explanation: block.explanation,
          title: "A routine for your week",
        };
      }
      case "PlanChangeProposal": {
        return {
          details: [],
          explanation: block.explanation,
          title: "A change to your family plan",
        };
      }
      case "PlanningContentProposal": {
        return {
          details: [],
          explanation: block.explanation,
          title: "A change to your meal setup",
        };
      }
      case "RecipeDetails": {
        return { recipeId: block.recipeId };
      }
      default: {
        return block satisfies never;
      }
    }
  })();
  return {
    elements: {
      block: { children: [], props, type: block._tag },
    },
    root: "block",
  };
};

const ProposalCard = ({
  block,
  props,
  busy,
  onAction,
  onRosterReview,
  reviewable = true,
}: {
  readonly block: ConversationBlock;
  readonly props: ProposalProps;
  readonly busy: boolean;
  readonly onAction: (
    block: ConversationBlock,
    decision: "accept" | "dismiss"
  ) => void;
  readonly onRosterReview?:
    | ((block: Extract<ConversationBlock, { _tag: "RosterProposal" }>) => void)
    | undefined;
  readonly reviewable?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Card size="sm">
      <CardHeader>
        <ReviewStatusBadge
          block={block}
          proposed={
            block._tag === "RosterProposal"
              ? "Family draft"
              : "Proposal · review required"
          }
        />
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.explanation}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul
          className="flex flex-col gap-2 text-sm"
          aria-label="Proposal details"
        >
          {props.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        {!reviewable && (
          <p className="text-muted-foreground text-sm">
            Current meal details are needed before this change can be confirmed.
            Refresh the meal details and review again.
          </p>
        )}
        {block.status === "proposed" && (
          <div className="flex flex-wrap gap-2">
            {block._tag === "RosterProposal" && onRosterReview !== undefined ? (
              <Button disabled={busy} onClick={() => onRosterReview(block)}>
                Review family draft
              </Button>
            ) : (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger
                  render={
                    <Button disabled={busy || !reviewable} variant="outline" />
                  }
                >
                  Review suggestion
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Review before confirming</DialogTitle>
                    <DialogDescription>
                      {props.title}. {props.explanation}
                    </DialogDescription>
                  </DialogHeader>
                  <ul className="flex flex-col gap-2 text-sm">
                    {props.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                      Keep reviewing
                    </Button>
                    <Button
                      disabled={busy || block._tag === "RosterProposal"}
                      onClick={() => {
                        onAction(block, "accept");
                        setOpen(false);
                      }}
                    >
                      Confirm change
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => onAction(block, "dismiss")}
            >
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const PlanReviewPrompt = ({
  block,
  explanation,
  busy,
  onPlanReview,
}: {
  readonly block: Extract<ConversationBlock, { _tag: "PlanChangeProposal" }>;
  readonly explanation: string;
  readonly busy: boolean;
  readonly onPlanReview?:
    | ((
        block: Extract<ConversationBlock, { _tag: "PlanChangeProposal" }>
      ) => void)
    | undefined;
}) => (
  <Card size="sm">
    <CardHeader>
      <ReviewStatusBadge
        block={block}
        proposed="Plan proposal · review required"
      />
      <CardTitle>A change to your family plan</CardTitle>
      <CardDescription>{explanation}</CardDescription>
    </CardHeader>
    {block.status === "proposed" && (
      <CardContent>
        {onPlanReview === undefined ? (
          <Button
            render={<Link to="/" search={{ area: "weeks" }} />}
            variant="outline"
          >
            Review in Our weeks
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => onPlanReview(block)}>
            Review full plan change
          </Button>
        )}
      </CardContent>
    )}
  </Card>
);

const PlanningContentReviewPrompt = ({
  block,
  busy,
  onReview,
}: {
  readonly block: Extract<
    ConversationBlock,
    { _tag: "PlanningContentProposal" }
  >;
  readonly busy: boolean;
  readonly onReview?:
    | ((
        block: Extract<ConversationBlock, { _tag: "PlanningContentProposal" }>
      ) => void)
    | undefined;
}) => (
  <Card size="sm">
    <CardHeader>
      <ReviewStatusBadge
        block={block}
        proposed="Meal setup · review required"
      />
      <CardTitle>A change to your meal setup</CardTitle>
      <CardDescription>{block.explanation}</CardDescription>
    </CardHeader>
    {block.status === "proposed" && (
      <CardContent>
        {onReview === undefined ? (
          <Button
            render={<Link to="/" search={{ area: "food" }} />}
            variant="outline"
          >
            Review in Food Book
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => onReview(block)}>
            Review meal setup change
          </Button>
        )}
      </CardContent>
    )}
  </Card>
);

const FactProposalCard = ({
  block,
  props,
  busy,
  personKnown,
  onAction,
}: {
  readonly block: Extract<ConversationBlock, { _tag: "PersonFactProposal" }>;
  readonly props: ProposalProps;
  readonly busy: boolean;
  readonly personKnown: boolean;
  readonly onAction: (
    block: ConversationBlock,
    decision: "accept" | "dismiss",
    safetyConfirmation?: "I confirm this safety constraint change" | null
  ) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [safetyChecked, setSafetyChecked] = useState(false);
  const safetyId = useId();
  return (
    <Card size="sm">
      <CardHeader>
        <ReviewStatusBadge
          block={block}
          proposed="Proposed fact · review required"
          accepted="Confirmed for family"
        />
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.explanation}</CardDescription>
      </CardHeader>
      <CardContent>
        {!personKnown && (
          <p role="status" className="text-sm">
            This food fact cannot be reviewed until this person is available in
            your family roster.
          </p>
        )}
        <ul
          className="flex flex-col gap-2 text-sm"
          aria-label="Before and after food fact"
        >
          {props.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        {block.status === "proposed" && personKnown && (
          <div className="flex flex-wrap gap-2">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger
                render={<Button disabled={busy} variant="outline" />}
              >
                Review food fact
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Share this food fact?</DialogTitle>
                  <DialogDescription>{props.explanation}</DialogDescription>
                </DialogHeader>
                <ul className="flex flex-col gap-2 text-sm">
                  {props.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
                {block.requiresSafetyConfirmation && (
                  <Field orientation="horizontal">
                    <Checkbox
                      id={safetyId}
                      checked={safetyChecked}
                      onCheckedChange={(checked) =>
                        setSafetyChecked(checked === true)
                      }
                    />
                    <FieldLabel htmlFor={safetyId}>
                      I confirm this safety constraint change
                    </FieldLabel>
                  </Field>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Keep reviewing
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      (block.requiresSafetyConfirmation && !safetyChecked)
                    }
                    onClick={() => {
                      onAction(
                        block,
                        "accept",
                        safetyChecked
                          ? "I confirm this safety constraint change"
                          : null
                      );
                      setOpen(false);
                    }}
                  >
                    Confirm for family
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => onAction(block, "dismiss")}
            >
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const FoodQuestion = ({
  block,
  props,
  busy,
  onAnswer,
}: {
  readonly block: Extract<ConversationBlock, { _tag: "Question" }>;
  readonly props: z.infer<typeof questionProps>;
  readonly busy: boolean;
  readonly onAnswer?:
    | ((
        block: Extract<ConversationBlock, { _tag: "Question" }>,
        answer: FoodAnswer
      ) => Promise<void>)
    | undefined;
}) => {
  const playInteractionSound = useInteractionSound();
  const food = props.foodTopic === null ? null : foodImages[props.foodTopic];
  const answers: readonly {
    readonly value: FoodAnswer;
    readonly label: string;
  }[] = [
    { label: "Yes", value: "yes" },
    { label: "With a change", value: "change" },
    { label: "No", value: "no" },
    { label: "Not sure", value: "unsure" },
  ];
  return (
    <div
      className={cn(
        "bg-accent grid overflow-hidden rounded-3xl",
        food !== null && "md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]"
      )}
    >
      <div className="flex flex-col gap-4 p-6 md:p-9">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {props.context}
        </p>
        <p
          className={cn(
            "font-display",
            food === null
              ? "text-2xl leading-snug"
              : "text-welcome-mobile md:text-signup-promise-mobile leading-tight"
          )}
        >
          {props.prompt}
        </p>
        {food !== null &&
          block.status === "proposed" &&
          onAnswer !== undefined && (
            <div
              className="flex flex-wrap gap-2"
              aria-label={`Answer about ${food.label}`}
            >
              {answers.map((answer) => (
                <Button
                  key={answer.value}
                  disabled={busy}
                  variant={answer.value === "yes" ? "default" : "outline"}
                  onClick={() => {
                    void playInteractionSound();
                    void onAnswer(block, answer.value);
                  }}
                >
                  {answer.label}
                </Button>
              ))}
            </div>
          )}
        {block.status !== "proposed" && (
          <ReviewStatusBadge block={block} proposed="Question" />
        )}
      </div>
      {food !== null && (
        <div className="relative min-h-56 overflow-hidden outline outline-1 outline-black/10 md:min-h-80">
          <img
            alt={`${food.label} as an illustration for a taste question`}
            className="size-full object-cover"
            height={600}
            loading="lazy"
            src={food.src}
            width={800}
          />
        </div>
      )}
    </div>
  );
};

export const ConversationBlockRenderer = ({
  block,
  busy,
  people = [],
  onAction,
  onAnswer,
  onRosterReview,
  onPlanReview,
  onPlanningContentReview,
  planningContent = null,
}: {
  readonly block: ConversationBlock;
  readonly busy: boolean;
  readonly people?: readonly {
    readonly id: string;
    readonly displayName: string;
  }[];
  readonly onAction: (
    block: ConversationBlock,
    decision: "accept" | "dismiss",
    safetyConfirmation?: "I confirm this safety constraint change" | null
  ) => void;
  readonly onAnswer?:
    | ((
        block: Extract<ConversationBlock, { _tag: "Question" }>,
        answer: FoodAnswer
      ) => Promise<void>)
    | undefined;
  readonly onRosterReview?:
    | ((block: Extract<ConversationBlock, { _tag: "RosterProposal" }>) => void)
    | undefined;
  readonly onPlanReview?:
    | ((
        block: Extract<ConversationBlock, { _tag: "PlanChangeProposal" }>
      ) => void)
    | undefined;
  readonly onPlanningContentReview?:
    | ((
        block: Extract<ConversationBlock, { _tag: "PlanningContentProposal" }>
      ) => void)
    | undefined;
  readonly planningContent?: PlanningContentSnapshot | null;
}) => {
  const candidate = specForBlock(block, people, planningContent);
  const validated = conversationCatalog.validate(candidate);
  if (!validated.success || validated.data === undefined) {
    return null;
  }
  const { registry } = defineRegistry(conversationCatalog, {
    components: {
      PersonFactProposal: ({ props }) =>
        block._tag === "PersonFactProposal" ? (
          <FactProposalCard
            block={block}
            props={props}
            busy={busy}
            personKnown={people.some((person) => person.id === block.personId)}
            onAction={onAction}
          />
        ) : null,
      PlanChangeProposal: ({ props }) =>
        block._tag === "PlanChangeProposal" ? (
          <PlanReviewPrompt
            block={block}
            explanation={props.explanation}
            busy={busy}
            onPlanReview={onPlanReview}
          />
        ) : null,
      PlanningContentProposal: () =>
        block._tag === "PlanningContentProposal" ? (
          <PlanningContentReviewPrompt
            block={block}
            busy={busy}
            onReview={onPlanningContentReview}
          />
        ) : null,
      Question: ({ props }) =>
        block._tag === "Question" ? (
          <FoodQuestion
            block={block}
            props={props}
            busy={busy}
            onAnswer={onAnswer}
          />
        ) : null,
      RecipeDetails: () =>
        block._tag === "RecipeDetails" ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Recipe details</CardTitle>
              <CardDescription>
                Inspect the saved recipe before planning it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                render={
                  <Link
                    to="/"
                    search={{ area: "food", recipeId: block.recipeId }}
                  />
                }
                variant="outline"
              >
                Open recipe
              </Button>
            </CardContent>
          </Card>
        ) : null,
      RosterProposal: ({ props }) => (
        <ProposalCard
          block={block}
          props={props}
          busy={busy}
          onAction={onAction}
          onRosterReview={onRosterReview}
        />
      ),
      RoutineProposal: ({ props }) => (
        <ProposalCard
          block={block}
          props={props}
          busy={busy}
          onAction={onAction}
          reviewable={
            block._tag === "RoutineProposal" &&
            canReviewRoutine(block, people, planningContent)
          }
        />
      ),
    },
  });
  // SAFETY: catalog.validate parsed the complete spec, while this release's
  // inferred slots type is wider than Renderer.Spec's equivalent field.
  return (
    <JSONUIProvider registry={registry}>
      <Renderer spec={validated.data as Spec} registry={registry} />
    </JSONUIProvider>
  );
};
