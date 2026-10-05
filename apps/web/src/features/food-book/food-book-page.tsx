import {
  HouseholdPlanningContentConflictProblem,
  HouseholdPlanningContentInvalidProblem,
  MealOption,
  MutatePlanningContentPayload,
  PlanningContentId,
  PlanningContentMutationId,
} from "@meal-planner/household-api";
import type {
  PlanningContentSnapshot,
  HouseholdPerson,
  PlanningContentCommand,
  SavedRecipeSummary,
} from "@meal-planner/household-api";
import { formatRecipeIngredient } from "@meal-planner/recipe-domain";
import { RecipeId } from "@meal-planner/recipe-import-api";
import type {
  CorrectedRecipe,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import {
  ArrowRightIcon,
  BookOpenIcon,
  ChefHatIcon,
  PlusIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { Overlay } from "../../components/ui/responsive-overlay.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.js";
import { FamilyConversationPanel } from "../agent-conversations/index.js";
import type {
  PlanningContentProposalReview,
  PlanProposalReviewActions,
} from "../agent-conversations/index.js";
import { queryFailure, useApiRuntime } from "../api-client/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import { familyRosterQueryOptions } from "../family/index.js";
import { useSessionPendingRequest } from "../request-recovery/index.js";
import { FocusedCookView } from "./focused-cook-view.js";
import { FoodCover } from "./food-cover.js";
import { NewMealOption } from "./new-meal-option.js";
import {
  FoodBookOperationFailure,
  foodBookKey,
  foodBookMutationOptions,
  foodBookQueryOptions,
  recipeDetailQueryOptions,
  savedRecipesQueryOptions,
} from "./operations.js";
import { OptionPlanningReview } from "./option-planning-review.js";
import { PlanningConstraints } from "./planning-constraints.js";
import { PlanningContentProposalReviewSheet } from "./planning-content-proposal-review.js";
import { PlanningFoundations } from "./planning-foundations.js";
import { PreparedFoodPanel } from "./prepared-food-panel.js";
import { SuitabilityReviewPanel } from "./suitability-review.js";

const optionKinds = [
  "all",
  "recipe",
  "assembled",
  "packaged",
  "external",
] as const;
type OptionKind = (typeof optionKinds)[number];

const optionKindLabel = (kind: MealOption["kind"]) =>
  ({
    assembled: "Assembled meal",
    external: "Eating out",
    packaged: "Packaged food",
    recipe: "Recipe",
  })[kind];

const quantityLabel = (
  quantity:
    | { _tag: "Known"; amount: number; unit: string }
    | { _tag: "Unresolved"; sourceText: string }
) =>
  quantity._tag === "Known"
    ? `${quantity.amount} ${quantity.unit}`
    : `Amount to review: ${quantity.sourceText}`;

const optionReview = (
  option: MealOption,
  snapshot: PlanningContentSnapshot
) => {
  if (
    option.kind === "recipe" &&
    (option.yield._tag === "Unresolved" ||
      option.shoppingStatus === "unresolved")
  ) {
    return "Yield or shopping amounts need review";
  }
  if (
    option.kind === "assembled" &&
    (option.yield._tag === "Unresolved" ||
      option.components.some((item) => item.quantity._tag === "Unresolved"))
  ) {
    return "Quantities need review";
  }
  if (option.kind === "packaged" && option.quantity._tag === "Unresolved") {
    return "Quantity needs review";
  }
  const reviews = snapshot.suitabilityReviews.filter(
    (review) =>
      review.optionRef.optionId === option.optionId &&
      review.optionRef.optionVersion === option.optionVersion
  );
  if (reviews.some((review) => review.status === "incompatible")) {
    return "Not suitable for a reviewed person";
  }
  if (
    reviews.length === 0 ||
    reviews.some((review) => review.status === "unknown")
  ) {
    return "Person suitability not confirmed";
  }
  return null;
};

const RecipeIngredientList = ({
  ingredients,
}: {
  readonly ingredients: readonly string[];
}) => {
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set());
  return (
    <section aria-labelledby="ingredients-title">
      <h3 id="ingredients-title" className="font-display mb-4 text-3xl">
        What you’ll need.
      </h3>
      {ingredients.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Ingredients have not been confirmed for this recipe.
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {ingredients.map((ingredient, index) => (
            <li
              className="flex min-h-12 items-center gap-3 py-2"
              key={`${ingredient}-${index}`}
            >
              <Checkbox
                aria-label={`Mark ${ingredient} as gathered`}
                checked={checked.has(index)}
                onCheckedChange={(value) =>
                  setChecked((previous) => {
                    const next = new Set(previous);
                    if (value) {
                      next.add(index);
                    } else {
                      next.delete(index);
                    }
                    return next;
                  })
                }
              />
              <span
                className={
                  checked.has(index) ? "text-muted-foreground line-through" : ""
                }
              >
                {ingredient}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
const RecipeMethodList = ({
  method,
  onStart,
}: {
  readonly method: readonly string[];
  readonly onStart: () => void;
}) => (
  <section aria-labelledby="method-title">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 id="method-title" className="font-display text-3xl">
        Let’s make it.
      </h3>
      {method.length > 0 && (
        <Button variant="outline" onClick={onStart}>
          <ChefHatIcon data-icon="inline-start" />
          Start cooking
        </Button>
      )}
    </div>
    {method.length === 0 ? (
      <p className="text-muted-foreground text-sm">
        Cooking instructions have not been confirmed for this recipe.
      </p>
    ) : (
      <ol className="flex flex-col gap-5">
        {method.map((instruction, index) => (
          <li
            className="border-border flex gap-4 border-b pb-5"
            key={`${instruction}-${index}`}
          >
            <span className="text-muted-foreground w-8 shrink-0 text-xs">
              {String(index + 1).padStart(2, "0")}
            </span>
            <p className="leading-7">{instruction}</p>
          </li>
        ))}
      </ol>
    )}
  </section>
);

const RecipeIntro = ({
  recipe,
  option,
}: {
  readonly recipe: CorrectedRecipe;
  readonly option: Extract<MealOption, { kind: "recipe" }> | undefined;
}) => (
  <>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-wrap items-start gap-5">
        {option && (
          <FoodCover
            cover={option.cover}
            label={option.label}
            className="size-24 md:size-40"
          />
        )}
        <div>
          <p className="text-muted-foreground text-xs tracking-widest uppercase">
            Saved recipe
          </p>
          <h2 className="font-display mt-2 text-4xl leading-none">
            {recipe.name ?? option?.label ?? "Recipe awaiting a name"}
          </h2>
          {recipe.description && (
            <p className="text-muted-foreground mt-3 text-sm leading-6">
              {recipe.description}
            </p>
          )}
        </div>
      </div>
      <Badge variant="secondary">
        {option ? quantityLabel(option.yield) : "Saved recipe"}
      </Badge>
    </div>
    {option &&
      (option.yield._tag === "Unresolved" ||
        option.shoppingStatus === "unresolved") && (
        <Alert>
          <AlertTitle>Planning amounts need review</AlertTitle>
          <AlertDescription>
            The source recipe is saved, but we can’t calculate shopping or
            portions from its current yield and ingredient amounts.
          </AlertDescription>
        </Alert>
      )}
    {!option && (
      <Alert>
        <AlertTitle>Saved recipe</AlertTitle>
        <AlertDescription>
          Add this recipe to your Food book and review its yield and shopping
          amounts before planning it.
        </AlertDescription>
      </Alert>
    )}
    <div className="text-muted-foreground flex flex-wrap gap-2 text-sm">
      {recipe.times.total !== null && (
        <span>{Math.ceil(recipe.times.total.seconds / 60)} minutes total</span>
      )}
      {recipe.servings !== null && (
        <span>· Source yield: {recipe.servings.original}</span>
      )}
      {recipe.author !== null && <span>· {recipe.author.name}</span>}
    </div>
  </>
);

const RecipeDetail = ({
  option,
  recipeId,
  scope,
}: {
  readonly option: Extract<MealOption, { kind: "recipe" }> | undefined;
  readonly recipeId: string;
  readonly scope: DisplayedIdentity;
}) => {
  const runtime = useApiRuntime();
  const recipeQuery = useQuery(
    recipeDetailQueryOptions(runtime, scope, recipeId)
  );
  const [cooking, setCooking] = useState(false);
  if (recipeQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (recipeQuery.isError) {
    return (
      <Alert>
        <AlertTitle>Recipe unavailable</AlertTitle>
        <AlertDescription>
          We couldn’t load the saved recipe.{" "}
          <Button
            variant="link"
            onClick={async () => {
              await recipeQuery.refetch();
            }}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const { recipe } = recipeQuery.data;
  const method = recipe.instructions?.map((step) => step.text) ?? [];
  const ingredients = recipe.ingredients?.map(formatRecipeIngredient) ?? [];
  if (cooking && method.length > 0) {
    return (
      <FocusedCookView
        cover={option?.cover ?? null}
        ingredients={ingredients}
        method={method}
        name={recipe.name ?? option?.label ?? "Saved recipe"}
        onClose={() => setCooking(false)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-7">
      <RecipeIntro recipe={recipe} option={option} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <RecipeIngredientList ingredients={ingredients} />
        <RecipeMethodList method={method} onStart={() => setCooking(true)} />
      </div>
    </div>
  );
};

const OptionDetail = ({
  option,
  scope,
  snapshot,
  onReview,
  onSuitability,
}: {
  readonly option: MealOption;
  readonly scope: DisplayedIdentity;
  readonly snapshot: PlanningContentSnapshot;
  readonly onReview: () => void;
  readonly onSuitability: () => void;
}) => {
  if (option.kind === "recipe") {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap">
          <Button variant="outline" onClick={onReview}>
            Review planning quantities
          </Button>
          <Button variant="outline" onClick={onSuitability}>
            Review person suitability
          </Button>
        </div>
        <RecipeDetail
          option={option}
          recipeId={option.recipeId}
          scope={scope}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-5">
        <FoodCover
          cover={option.cover}
          label={option.label}
          className="size-28"
        />
        <div>
          <p className="text-muted-foreground text-xs tracking-widest uppercase">
            {optionKindLabel(option.kind)}
          </p>
          <h2 className="font-display mt-2 text-4xl">{option.label}</h2>
        </div>
      </div>
      {option.kind !== "external" && (
        <Button variant="outline" onClick={onReview} className="self-start">
          Review planning quantities
        </Button>
      )}
      <Button variant="outline" onClick={onSuitability} className="self-start">
        Review person suitability
      </Button>
      {optionReview(option, snapshot) && (
        <Alert>
          <AlertTitle>Needs a person review</AlertTitle>
          <AlertDescription>
            {optionReview(option, snapshot)}. A meal is not treated as
            compatible until it is checked against a current confirmed food
            profile.
          </AlertDescription>
        </Alert>
      )}
      {option.kind === "assembled" && (
        <section>
          <h3 className="font-display text-3xl">What goes in.</h3>
          <ul className="divide-border mt-4 divide-y">
            {option.components.map((item) => (
              <li className="flex justify-between gap-4 py-3" key={item.name}>
                <span>{item.name}</span>
                <span className="text-muted-foreground text-sm">
                  {quantityLabel(item.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-4 text-sm">
            Yield: {quantityLabel(option.yield)}
          </p>
        </section>
      )}
      {option.kind === "packaged" && (
        <p className="text-sm leading-6">
          {option.productName} · {quantityLabel(option.quantity)}
          {option.productIdentity ? ` · ${option.productIdentity}` : ""}
        </p>
      )}
      {option.kind === "external" && (
        <p className="text-sm leading-6">
          {option.provider ?? "Provider not specified"}. This choice does not
          add ingredients to shopping.
        </p>
      )}
    </div>
  );
};

const SavedRecipeList = ({
  scope,
  linkedRecipeIds,
  onOpen,
  onAttach,
  pending,
}: {
  readonly scope: DisplayedIdentity;
  readonly linkedRecipeIds: ReadonlySet<string>;
  readonly onOpen: (recipeId: RecipeId) => void;
  readonly onAttach: (recipe: SavedRecipeSummary) => void;
  readonly pending: boolean;
}) => {
  const runtime = useApiRuntime();
  const [cursor, setCursor] = useState<string>();
  const query = useQuery(savedRecipesQueryOptions(runtime, scope, cursor));
  return (
    <section className="border-border border-t pt-8">
      <div className="mb-5">
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          Saved imports
        </p>
        <h2 className="font-display mt-2 text-3xl">Recipes you brought in.</h2>
      </div>
      {query.isPending && <Skeleton className="h-28 w-full" />}
      {query.isError && (
        <Alert>
          <AlertTitle>Saved recipes unavailable</AlertTitle>
          <AlertDescription>
            We couldn’t load the import list.{" "}
            <Button
              variant="link"
              onClick={async () => {
                await query.refetch();
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {query.data &&
        (query.data.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No reviewed recipe imports are saved yet.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {query.data.items.map((recipe) => (
              <li
                key={recipe.recipeId}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <button
                  type="button"
                  className="text-left underline"
                  onClick={() =>
                    onOpen(Schema.decodeUnknownSync(RecipeId)(recipe.recipeId))
                  }
                >
                  {recipe.name ?? "Recipe awaiting a name"}
                </button>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Version {recipe.version}</Badge>
                  {linkedRecipeIds.has(recipe.recipeId) ? (
                    <span className="text-muted-foreground text-xs">
                      In Food book
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || recipe.name === null}
                      onClick={() => onAttach(recipe)}
                    >
                      Add to Food book
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}
      {query.data?.nextCursor && (
        <Button
          className="mt-5"
          variant="ghost"
          onClick={() => {
            if (query.data?.nextCursor) {
              setCursor(query.data.nextCursor);
            }
          }}
        >
          More saved recipes
        </Button>
      )}
      {cursor && (
        <Button
          className="mt-5"
          variant="ghost"
          onClick={() => setCursor(undefined)}
        >
          First page
        </Button>
      )}
    </section>
  );
};

const filterLabel = (kind: OptionKind) => {
  switch (kind) {
    case "all": {
      return "All";
    }
    case "assembled": {
      return "Assembled";
    }
    case "external": {
      return "Eating out";
    }
    case "packaged": {
      return "Packaged";
    }
    case "recipe": {
      return "Recipes";
    }
    default: {
      return "Meals";
    }
  }
};
const routineLabel = (
  routine: PlanningContentSnapshot["routines"][number],
  snapshot: PlanningContentSnapshot
) => {
  switch (routine.choice._tag) {
    case "Options": {
      return routine.choice.optionRefs
        .map(
          (ref) =>
            snapshot.options.find((option) => option.optionId === ref.optionId)
              ?.label ?? "Saved option unavailable"
        )
        .join(" · ");
    }
    case "External": {
      return "Eating out";
    }
    case "Leftover": {
      return "Prepared food";
    }
    case "Skip": {
      return "Intentionally skipped";
    }
    case "Flexible": {
      return "Decide on the day";
    }
    default: {
      return "Meal choice needs review";
    }
  }
};
const FoodOptionsGrid = ({
  snapshot,
  options,
  kind,
  importHref,
  onAdd,
  onSelect,
  pending,
}: {
  readonly snapshot: PlanningContentSnapshot;
  readonly options: readonly MealOption[];
  readonly kind: OptionKind;
  readonly importHref: string;
  readonly onAdd: () => void;
  readonly onSelect: (id: string) => void;
  readonly pending: boolean;
}) => {
  if (snapshot.options.length === 0) {
    return (
      <div className="bg-accent rounded-3xl p-7 md:p-10">
        <BookOpenIcon className="mb-6" />
        <h2 className="font-display text-4xl">Make this yours.</h2>
        <p className="mt-3 max-w-lg leading-7">
          Save a recipe or a familiar meal to give the planner a real choice.
          Imported recipes appear after your review.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button render={<a href={importHref} />}>Import a recipe</Button>
          <Button variant="outline" disabled={pending} onClick={onAdd}>
            Add a familiar meal
          </Button>
        </div>
      </div>
    );
  }
  if (options.length === 0) {
    return (
      <p className="text-muted-foreground py-10">
        No {kind} meals are saved yet.
      </p>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {options.map((option) => (
        <Card key={option.optionId} className="cursor-pointer">
          <button
            type="button"
            className="w-full text-left"
            onClick={() => onSelect(option.optionId)}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <FoodCover
                  cover={option.cover}
                  label={option.label}
                  className="size-24"
                />
                <Badge variant="secondary" className="w-fit">
                  {optionKindLabel(option.kind)}
                </Badge>
              </div>
              <CardTitle>{option.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm leading-6">
                {optionReview(option, snapshot) ??
                  "Open details and suitability"}
              </p>
              <span className="mt-4 inline-flex items-center gap-2 text-sm underline">
                Open food <ArrowRightIcon className="size-4" />
              </span>
            </CardContent>
          </button>
        </Card>
      ))}
    </div>
  );
};
const FoodBrowse = ({
  snapshot,
  options,
  kind,
  setKind,
  importHref,
  onAdd,
  onSelect,
  pending,
}: {
  readonly snapshot: PlanningContentSnapshot;
  readonly options: readonly MealOption[];
  readonly kind: OptionKind;
  readonly setKind: (kind: OptionKind) => void;
  readonly importHref: string;
  readonly onAdd: () => void;
  readonly onSelect: (id: string) => void;
  readonly pending: boolean;
}) => (
  <>
    <ToggleGroup
      aria-label="Filter meals"
      value={[kind]}
      onValueChange={(values) => {
        const [next] = values;
        if (next && optionKinds.includes(next as OptionKind)) {
          setKind(next as OptionKind);
        }
      }}
      className="flex max-w-full flex-wrap"
    >
      {optionKinds.map((item) => (
        <ToggleGroupItem key={item} value={item}>
          {filterLabel(item)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
    <FoodOptionsGrid
      snapshot={snapshot}
      options={options}
      kind={kind}
      importHref={importHref}
      onAdd={onAdd}
      onSelect={onSelect}
      pending={pending}
    />
    {snapshot.routines.length > 0 && (
      <section className="border-border border-t pt-8">
        <h2 className="font-display text-3xl">Familiar rhythms.</h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {snapshot.routines
            .filter((routine) => routine.state === "active")
            .map((routine) => (
              <li
                key={routine.id}
                className="border-border rounded-2xl border p-4"
              >
                <p className="text-sm font-medium">
                  {routine.scope._tag === "Household"
                    ? "For the family"
                    : "For one person"}{" "}
                  ·{" "}
                  {routine.weekdays.length === 7
                    ? "Every day"
                    : `${routine.weekdays.length} days a week`}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {routineLabel(routine, snapshot)}
                </p>
              </li>
            ))}
        </ul>
      </section>
    )}
  </>
);

interface SetupProposal {
  readonly block: Parameters<PlanningContentProposalReview>[0];
  readonly actions: PlanProposalReviewActions;
}
const FoodBookOverlays = ({
  scope,
  snapshot,
  people,
  setupProposal,
  setSetupProposal,
  adding,
  setAdding,
  selected,
  setSelectedId,
  reviewId,
  setReviewId,
  suitabilityId,
  setSuitabilityId,
  selectedReviewOption,
  selectedSuitabilityOption,
  selectedRecipeId,
  setSelectedRecipeId,
  pending,
  saving,
  onSave,
  onCommand,
}: {
  readonly scope: DisplayedIdentity;
  readonly snapshot: PlanningContentSnapshot | undefined;
  readonly people: readonly HouseholdPerson[] | undefined;
  readonly setupProposal: SetupProposal | null;
  readonly setSetupProposal: (value: SetupProposal | null) => void;
  readonly adding: boolean;
  readonly setAdding: (value: boolean) => void;
  readonly selected: MealOption | undefined;
  readonly setSelectedId: (value: string | null) => void;
  readonly reviewId: string | null;
  readonly setReviewId: (value: string | null) => void;
  readonly suitabilityId: string | null;
  readonly setSuitabilityId: (value: string | null) => void;
  readonly selectedReviewOption: MealOption | undefined;
  readonly selectedSuitabilityOption: MealOption | undefined;
  readonly selectedRecipeId: string | null;
  readonly setSelectedRecipeId: (value: string | null) => void;
  readonly pending: boolean;
  readonly saving: boolean;
  readonly onSave: (option: MealOption) => void;
  readonly onCommand: (command: PlanningContentCommand) => void;
}) => (
  <>
    <Overlay.Root
      open={setupProposal !== null}
      onOpenChange={(open) => {
        if (!open) {
          setSetupProposal(null);
        }
      }}
      desktop="drawer"
    >
      <Overlay.Content data-theme="journey">
        <Overlay.Header>
          <Overlay.Title className="sr-only">
            Review Food book proposal
          </Overlay.Title>
          <Overlay.Description className="sr-only">
            Review the exact assistant change.
          </Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          {setupProposal && (
            <PlanningContentProposalReviewSheet
              scope={scope}
              block={setupProposal.block}
              actions={setupProposal.actions}
              onClose={() => setSetupProposal(null)}
            />
          )}
        </Overlay.Body>
      </Overlay.Content>
    </Overlay.Root>
    <Overlay.Root open={adding} onOpenChange={setAdding} desktop="drawer">
      <Overlay.Content data-theme="journey">
        <Overlay.Header>
          <Overlay.Title className="sr-only">Add a meal</Overlay.Title>
          <Overlay.Description className="sr-only">
            Save a familiar household option.
          </Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          <NewMealOption onSave={onSave} />
        </Overlay.Body>
        <Overlay.Footer>
          <Button type="submit" form="new-meal-option" disabled={pending}>
            {saving ? "Saving meal…" : "Save meal"}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </Overlay.Footer>
      </Overlay.Content>
    </Overlay.Root>
    <Overlay.Root
      open={
        selected !== undefined && reviewId === null && suitabilityId === null
      }
      onOpenChange={(open) => {
        if (!open) {
          setSelectedId(null);
        }
      }}
      desktop="drawer"
    >
      <Overlay.Content data-theme="journey">
        <Overlay.Header>
          <Overlay.Title className="sr-only">
            {selected?.label ?? "Meal details"}
          </Overlay.Title>
          <Overlay.Description className="sr-only">
            Saved content and source details
          </Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          {selected && snapshot && (
            <OptionDetail
              option={selected}
              scope={scope}
              snapshot={snapshot}
              onReview={() => setReviewId(selected.optionId)}
              onSuitability={() => setSuitabilityId(selected.optionId)}
            />
          )}
        </Overlay.Body>
      </Overlay.Content>
    </Overlay.Root>
    <Overlay.Root
      open={reviewId !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReviewId(null);
        }
      }}
      desktop="drawer"
    >
      <Overlay.Content data-theme="journey">
        <Overlay.Header>
          <Overlay.Title className="sr-only">Planning quantities</Overlay.Title>
          <Overlay.Description className="sr-only">
            Review the amounts used for planning and shopping.
          </Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          {selectedReviewOption && (
            <OptionPlanningReview
              key={reviewId}
              option={selectedReviewOption}
              pending={pending}
              onSave={(option) => {
                onSave(option);
                setReviewId(null);
                setSelectedId(null);
              }}
            />
          )}
        </Overlay.Body>
      </Overlay.Content>
    </Overlay.Root>
    <Overlay.Root
      open={suitabilityId !== null}
      onOpenChange={(open) => {
        if (!open) {
          setSuitabilityId(null);
        }
      }}
      desktop="drawer"
    >
      <Overlay.Content data-theme="journey">
        <Overlay.Header>
          <Overlay.Title className="sr-only">Person suitability</Overlay.Title>
          <Overlay.Description className="sr-only">
            Review this meal against a current confirmed profile.
          </Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          {selectedSuitabilityOption && snapshot && people && (
            <SuitabilityReviewPanel
              key={suitabilityId}
              scope={scope}
              option={selectedSuitabilityOption}
              snapshot={snapshot}
              people={people}
              pending={pending}
              onCommand={(command) => {
                onCommand(command);
                setSuitabilityId(null);
                setSelectedId(null);
              }}
            />
          )}
        </Overlay.Body>
      </Overlay.Content>
    </Overlay.Root>
    <Overlay.Root
      open={selectedRecipeId !== null}
      onOpenChange={(open) => {
        if (!open) {
          setSelectedRecipeId(null);
        }
      }}
      desktop="drawer"
    >
      <Overlay.Content data-theme="journey">
        <Overlay.Header>
          <Overlay.Title>Saved recipe</Overlay.Title>
          <Overlay.Description>
            Original ingredients and method
          </Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          {selectedRecipeId && (
            <RecipeDetail
              recipeId={selectedRecipeId}
              option={snapshot?.options.find(
                (option): option is Extract<MealOption, { kind: "recipe" }> =>
                  option.kind === "recipe" &&
                  option.recipeId === selectedRecipeId
              )}
              scope={scope}
            />
          )}
        </Overlay.Body>
      </Overlay.Content>
    </Overlay.Root>
  </>
);

const FoodBookLoadStatus = ({
  loading,
  loadError,
  saveError,
  retained,
  pending,
  onReload,
  onReconcile,
  onRetry,
}: {
  readonly loading: boolean;
  readonly loadError: boolean;
  readonly saveError: string | null;
  readonly retained: MutatePlanningContentPayload | null;
  readonly pending: boolean;
  readonly onReload: () => Promise<void>;
  readonly onReconcile: () => Promise<void>;
  readonly onRetry: (request: MutatePlanningContentPayload) => void;
}) => (
  <>
    {loading && (
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    )}
    {loadError && (
      <Alert variant="destructive">
        <AlertTitle>Food book unavailable</AlertTitle>
        <AlertDescription>
          Your saved choices couldn’t be loaded.{" "}
          <Button variant="link" onClick={onReload}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )}
    {saveError && (
      <Alert variant="destructive">
        <AlertTitle>Food book change needs review</AlertTitle>
        <AlertDescription>{saveError}</AlertDescription>
      </Alert>
    )}
    {retained && !pending && (
      <Alert variant="destructive">
        <AlertTitle>Save result unknown</AlertTitle>
        <AlertDescription>
          We kept this exact meal request. Check the saved Food book before
          retrying it.{" "}
          <Button variant="link" onClick={onReconcile}>
            Check saved meals
          </Button>{" "}
          <Button
            variant="link"
            disabled={pending}
            onClick={() => onRetry(retained)}
          >
            Retry same request
          </Button>
        </AlertDescription>
      </Alert>
    )}
  </>
);

export const FoodBookPage = ({
  scope,
  initialIntentId,
  initialRecipeId,
  importHref = "/?area=food&import=true",
}: {
  readonly scope: DisplayedIdentity;
  readonly initialIntentId?: RecipeImportIntentId;
  readonly initialRecipeId?: RecipeId;
  readonly importHref?: string;
}) => {
  const runtime = useApiRuntime();
  const client = useQueryClient();
  const query = useQuery(foodBookQueryOptions(runtime, scope));
  const roster = useQuery(
    familyRosterQueryOptions(runtime, scope.userId, scope.organizationId)
  );
  const [kind, setKind] = useState<OptionKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [suitabilityId, setSuitabilityId] = useState<string | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(
    initialRecipeId ?? null
  );
  const [adding, setAdding] = useState(false);
  const [setupProposal, setSetupProposal] = useState<{
    readonly block: Parameters<PlanningContentProposalReview>[0];
    readonly actions: PlanProposalReviewActions;
  } | null>(null);
  const retainedRequest = useSessionPendingRequest(
    `meal-planner.food-book.request.v1:${JSON.stringify([scope.userId, scope.organizationId])}`,
    MutatePlanningContentPayload,
    (request) => request.mutationId
  );
  const retained = retainedRequest.pending;
  const [saveError, setSaveError] = useState<string | null>(null);
  const addingMutationId = useRef<PlanningContentMutationId | null>(null);
  const mutation = useMutation({
    ...foodBookMutationOptions(runtime, scope),
    onError: async (error, request) => {
      const failure = queryFailure(error);
      if (failure instanceof FoodBookOperationFailure) {
        const conflict = Schema.decodeUnknownOption(
          HouseholdPlanningContentConflictProblem
        )(failure.cause);
        const invalid = Schema.decodeUnknownOption(
          HouseholdPlanningContentInvalidProblem
        )(failure.cause);
        if (Option.isSome(conflict) || Option.isSome(invalid)) {
          retainedRequest.release(request);
          setSaveError(
            "The Food book rejected this change. Refresh the latest details, then review and save a new request."
          );
          await query.refetch();
        }
      }
    },
    onSuccess: (snapshot, request) => {
      client.setQueryData(foodBookKey(scope), snapshot);
      retainedRequest.release(request);
      if (request.mutationId === addingMutationId.current) {
        addingMutationId.current = null;
        setAdding(false);
      }
    },
  });
  const changePending = mutation.isPending || retainedRequest.isBlocked;
  const snapshot = query.data;
  const options = useMemo(
    () =>
      snapshot?.options.filter(
        (option) => kind === "all" || option.kind === kind
      ) ?? [],
    [snapshot, kind]
  );
  const selected = snapshot?.options.find(
    (option) => option.optionId === selectedId
  );
  const selectedReviewOption = snapshot?.options.find(
    (option) => option.optionId === reviewId
  );
  const selectedSuitabilityOption = snapshot?.options.find(
    (option) => option.optionId === suitabilityId
  );
  const linkedRecipeIds = useMemo(
    () =>
      new Set(
        snapshot?.options
          .filter((option) => option.kind === "recipe")
          .map((option) => option.recipeId)
      ),
    [snapshot]
  );
  const mutateCommand = (
    command: PlanningContentCommand,
    source?: "new-meal-form"
  ) => {
    if (!snapshot || changePending) {
      return;
    }
    const payload = Schema.decodeUnknownSync(PlanningContentMutationId)(
      crypto.randomUUID()
    );
    const request: MutatePlanningContentPayload = {
      command,
      expectedVersion: snapshot.configVersion,
      mutationId: payload,
    };
    if (!retainedRequest.retain(request)) {
      return;
    }
    if (source === "new-meal-form") {
      addingMutationId.current = request.mutationId;
    }
    setSaveError(null);
    mutation.mutate(request);
  };
  const save = (option: MealOption) =>
    mutateCommand({ _tag: "PutOption", value: option }, "new-meal-form");
  const attachRecipe = (recipe: SavedRecipeSummary) => {
    if (recipe.name === null) {
      return;
    }
    const option = Schema.decodeUnknownSync(MealOption)({
      cover: null,
      kind: "recipe",
      label: recipe.name,
      optionId: Schema.decodeUnknownSync(PlanningContentId)(
        crypto.randomUUID()
      ),
      optionVersion: 1,
      preparation: {
        attention: "unknown",
        cleanup: "unknown",
        elapsedTime: { _tag: "Unknown" },
        handsOnTime: { _tag: "Unknown" },
        requiredEquipment: [],
        startRequirement: "unknown",
        substantialCookEvent: "unknown",
      },
      recipeId: recipe.recipeId,
      recipeImportId: recipe.importId,
      recipeVersion: recipe.version,
      shoppingComponents: [],
      shoppingStatus: "unresolved",
      yield: {
        _tag: "Unresolved",
        sourceText: "Yield not reviewed for planning",
      },
    });
    save(option);
  };
  const reconcile = async () => {
    await query.refetch();
    setSaveError(
      "The latest Food book is shown. If the save result is still unknown, retry the same retained request to get its canonical receipt."
    );
  };
  return (
    <section
      aria-labelledby="food-book-title"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 py-5 md:gap-8 md:py-8"
    >
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
            Food we love
          </p>
          <h1
            id="food-book-title"
            className="font-display mt-3 text-5xl leading-none md:text-7xl"
          >
            Your food book.
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl leading-7">
            Recipes, familiar meals and the choices your family can actually
            use.
          </p>
        </div>
        <div className="flex flex-wrap">
          <Button variant="outline" render={<a href={importHref} />}>
            <BookOpenIcon data-icon="inline-start" />
            Import recipe
          </Button>
          <Button disabled={changePending} onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" />
            Add a meal
          </Button>
        </div>
      </header>
      {initialIntentId && (
        <Alert>
          <AlertTitle>Recipe import in progress</AlertTitle>
          <AlertDescription>
            Finish reviewing the import before it becomes a saved recipe choice.{" "}
            <a href={importHref} className="underline">
              Continue import
            </a>
            .
          </AlertDescription>
        </Alert>
      )}
      <FoodBookLoadStatus
        loading={query.isPending}
        loadError={query.isError}
        saveError={retainedRequest.error ?? saveError}
        retained={retained}
        pending={mutation.isPending}
        onReload={async () => {
          await query.refetch();
        }}
        onReconcile={reconcile}
        onRetry={(request) => mutation.mutate(request)}
      />
      {snapshot && (
        <>
          <FoodBrowse
            snapshot={snapshot}
            options={options}
            kind={kind}
            setKind={setKind}
            importHref={importHref}
            onAdd={() => setAdding(true)}
            onSelect={setSelectedId}
            pending={changePending}
          />
          <section className="bg-accent/50 rounded-3xl p-5 md:p-8">
            <p className="text-muted-foreground text-xs tracking-widest uppercase">
              Plan from your words
            </p>
            <h2 className="font-display mt-2 text-3xl">
              Tell us what works at home.
            </h2>
            <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
              Describe usual meals, school days and cooking limits. Review each
              exact Food book change before it is saved.
            </p>
            <div className="mt-5">
              <FamilyConversationPanel
                scope={scope}
                onPlanningContentProposalReview={(block, actions) =>
                  setSetupProposal({ actions, block })
                }
              />
            </div>
          </section>
          <SavedRecipeList
            scope={scope}
            linkedRecipeIds={linkedRecipeIds}
            onOpen={(recipeId) => setSelectedRecipeId(recipeId)}
            onAttach={attachRecipe}
            pending={changePending}
          />
          {roster.data && (
            <PlanningFoundations
              snapshot={snapshot}
              people={roster.data.people.filter(
                (person) => person.lifecycle === "active"
              )}
              pending={changePending}
              onCommand={mutateCommand}
            />
          )}
          {roster.data && snapshot.managedOccasions.length > 0 && (
            <PlanningConstraints
              key={snapshot.configVersion}
              snapshot={snapshot}
              people={roster.data.people.filter(
                (person) => person.lifecycle === "active"
              )}
              pending={changePending}
              onCommand={mutateCommand}
            />
          )}
          <PreparedFoodPanel
            snapshot={snapshot}
            pending={changePending}
            onCommand={mutateCommand}
          />
          {roster.isError && (
            <Alert>
              <AlertTitle>Family roster unavailable</AlertTitle>
              <AlertDescription>
                We couldn’t load the people needed for routines and fallbacks.{" "}
                <Button
                  variant="link"
                  onClick={async () => {
                    await roster.refetch();
                  }}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
      <FoodBookOverlays
        scope={scope}
        snapshot={snapshot}
        people={roster.data?.people.filter(
          (person) => person.lifecycle === "active"
        )}
        setupProposal={setupProposal}
        setSetupProposal={setSetupProposal}
        adding={adding}
        setAdding={setAdding}
        selected={selected}
        setSelectedId={setSelectedId}
        reviewId={reviewId}
        setReviewId={setReviewId}
        suitabilityId={suitabilityId}
        setSuitabilityId={setSuitabilityId}
        selectedReviewOption={selectedReviewOption}
        selectedSuitabilityOption={selectedSuitabilityOption}
        selectedRecipeId={selectedRecipeId}
        setSelectedRecipeId={setSelectedRecipeId}
        pending={changePending}
        saving={
          mutation.isPending &&
          mutation.variables?.mutationId === addingMutationId.current
        }
        onSave={save}
        onCommand={mutateCommand}
      />
    </section>
  );
};
