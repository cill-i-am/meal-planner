import {
  emptyRecipeDetails,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import {
  RecipeImportAction,
  RecipeImportActionId,
  ProcessingRecipeImportIntent,
  RequiresActionRecipeImportIntent,
  SucceededRecipeImportIntent,
  Recipe,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecipeImportOperations } from "./browser-operations.js";
import { RecipeDetails } from "./recipe-details.js";
import { RecipeImportPage } from "./recipe-import-page.js";

afterEach(cleanup);

const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "11111111-1111-4111-8111-111111111111"
);
const timestamp = "2026-08-17T00:00:00.000Z";
const actionId = Schema.decodeUnknownSync(RecipeImportActionId)("a".repeat(64));
const processing = Schema.decodeUnknownSync(ProcessingRecipeImportIntent)({
  activity: { type: "working" },
  createdAt: timestamp,
  id: intentId,
  intentVersion: 1,
  links: {
    self: `/v1/recipe-import-intents/${intentId}`,
    timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
  },
  object: "recipe_import_intent",
  processing: { startedAt: timestamp, type: "resolving_source" },
  source: { kind: "tiktok", resolution: "pending" },
  status: "processing",
  updatedAt: timestamp,
});
const requiresAction = Schema.decodeUnknownSync(
  RequiresActionRecipeImportIntent
)({
  action: {
    id: actionId,
    link: `/v1/recipe-import-intents/${intentId}/actions/${actionId}`,
    type: "review_recipe",
  },
  createdAt: timestamp,
  id: intentId,
  intentVersion: 2,
  links: {
    self: `/v1/recipe-import-intents/${intentId}`,
    timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
  },
  object: "recipe_import_intent",
  source: {
    canonicalUrl: "https://www.tiktok.com/@cook/video/7390123456789012345",
    kind: "tiktok",
    resolution: "resolved",
  },
  status: "requires_action",
  updatedAt: timestamp,
});
const activeAction = Schema.decodeUnknownSync(RecipeImportAction)({
  actionVersion: 3,
  id: actionId,
  intentId,
  object: "recipe_import_action",
  review: {
    answers: [],
    blockers: { invalidFields: [], unresolvedRequiredFields: [] },
    editableFields: ["name"],
    recipe: {
      ...emptyRecipeDetails,
      cuisines: ["Irish"],
      ingredients: [recipeIngredientFromText("400 g beef")],
      instructions: [recipeInstructionFromText("Simmer until tender.", 1)],
      name: "Irish stew",
    },
    tags: null,
  },
  status: "active",
  type: "review_recipe",
});

const recipeId = "22222222-2222-4222-8222-222222222222";
const succeeded = Schema.decodeUnknownSync(SucceededRecipeImportIntent)({
  ...Schema.encodeSync(RequiresActionRecipeImportIntent)(requiresAction),
  completedAt: timestamp,
  result: { recipeId },
  status: "succeeded",
});
const savedRecipe = Schema.decodeUnknownSync(Recipe)({
  id: recipeId,
  object: "recipe",
  recipe: activeAction.review.recipe,
  tags: {
    cuisines: ["Irish"],
    difficulty: "easy",
    leftovers: "one_meal",
    mealTypes: ["dinner"],
    totalTimeBand: "30_to_60_minutes",
  },
});

const makeOperations = (
  overrides: Partial<RecipeImportOperations> = {}
): RecipeImportOperations => ({
  answerAction: vi.fn(),
  cancel: vi.fn(),
  confirmAction: vi.fn(),
  create: vi.fn(() => Effect.succeed(processing)),
  getAction: vi.fn(),
  getIntent: vi.fn(() => Effect.succeed(processing)),
  getRecipe: vi.fn(),
  ...overrides,
});

const renderPage = (operations: RecipeImportOperations, onSignOut = vi.fn()) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <RecipeImportPage
        householdId="household-1"
        householdName="Barron household"
        makeRequestId={() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
        onSignOut={onSignOut}
        operations={operations}
        pollIntervalMs={60_000}
      />
    </QueryClientProvider>
  );

describe("RecipeImportPage", () => {
  it("shows the authenticated household and logs out", async () => {
    const onSignOut = vi.fn(async () => {});
    renderPage(makeOperations(), onSignOut);

    expect(screen.getByText("Barron household")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("submits a recipe import in the active household session", async () => {
    const create = vi.fn(
      (_input: Parameters<RecipeImportOperations["create"]>[0]) =>
        Effect.succeed(processing)
    );
    renderPage(makeOperations({ create }));
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Recipe link" }),
      "https://www.tiktok.com/@cook/video/7390123456789012345"
    );
    await user.click(screen.getByRole("button", { name: "Import recipe" }));

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]?.[0]).toEqual({
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      request: {
        source: {
          kind: "tiktok",
          url: "https://www.tiktok.com/@cook/video/7390123456789012345",
        },
      },
    });
    expect(
      await screen.findByRole("heading", { name: "Working on your recipe" })
    ).toBeInTheDocument();
  });

  it("shows a safe error when the API request fails", async () => {
    renderPage(
      makeOperations({
        create: vi.fn(() =>
          Effect.sync(() => {
            throw new Error("secret");
          })
        ),
      })
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Recipe link" }),
      "https://www.tiktok.com/@cook/video/7390123456789012345"
    );
    await user.click(screen.getByRole("button", { name: "Import recipe" }));

    expect(
      await screen.findByRole("heading", {
        name: "This import couldn’t be completed",
      })
    ).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("confirms the exact review version and renders the saved recipe", async () => {
    const confirmAction = vi.fn<RecipeImportOperations["confirmAction"]>(() =>
      Effect.succeed(succeeded)
    );
    const getRecipe = vi.fn(() => Effect.succeed(savedRecipe));
    renderPage(
      makeOperations({
        confirmAction,
        create: vi.fn(() => Effect.succeed(processing)),
        getAction: vi.fn(() => Effect.succeed(activeAction)),
        getIntent: vi.fn(() => Effect.succeed(requiresAction)),
        getRecipe,
      })
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Recipe link" }),
      "https://www.tiktok.com/@cook/video/7390123456789012345"
    );
    await user.click(screen.getByRole("button", { name: "Import recipe" }));

    expect(
      await screen.findByRole("heading", { name: "Review recipe" })
    ).toBeInTheDocument();
    expect(screen.getByText("Irish stew")).toBeInTheDocument();
    expect(screen.getByText("400 g beef")).toBeInTheDocument();
    expect(screen.getByText("1. Simmer until tender.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm recipe" }));

    await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
    expect(confirmAction.mock.calls[0]?.[0]).toEqual({
      actionId,
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      intentId,
      request: { expectedActionVersion: 3 },
    });
    expect(
      await screen.findByRole("heading", { name: "Recipe saved" })
    ).toBeInTheDocument();
    expect(getRecipe).toHaveBeenCalledWith({ recipeId });
    expect(screen.getByText("Irish stew")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Review recipe" })
    ).not.toBeInTheDocument();
  });

  it("validates the source URL before sending a request", async () => {
    const operations = makeOperations();
    renderPage(operations);
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Recipe link" }),
      "http://example.com/recipe"
    );
    await user.tab();
    expect(
      await screen.findByText("Enter an absolute HTTPS recipe link.")
    ).toBeInTheDocument();
    expect(operations.create).not.toHaveBeenCalled();
  });

  it("validates the recipe name and saves schema-backed planning selections", async () => {
    const action = Schema.decodeUnknownSync(RecipeImportAction)({
      ...Schema.encodeSync(RecipeImportAction)(activeAction),
      review: { ...activeAction.review, editableFields: ["name", "tags"] },
    });
    const answerAction = vi.fn<RecipeImportOperations["answerAction"]>(() =>
      Effect.succeed(requiresAction)
    );
    renderPage(
      makeOperations({
        answerAction,
        getAction: vi.fn(() => Effect.succeed(action)),
        getIntent: vi.fn(() => Effect.succeed(requiresAction)),
      })
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Recipe link" }),
      "https://www.tiktok.com/@cook/video/7390123456789012345"
    );
    await user.click(screen.getByRole("button", { name: "Import recipe" }));
    const name = await screen.findByRole("textbox", { name: "Recipe name" });
    await user.clear(name);
    await user.tab();
    expect(await screen.findByText("Enter a recipe name.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save recipe name" }));
    expect(answerAction).not.toHaveBeenCalled();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Meal type" }),
      "lunch"
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Difficulty" }),
      "medium"
    );
    await user.click(
      screen.getByRole("button", { name: "Save planning tags" })
    );
    await waitFor(() => expect(answerAction).toHaveBeenCalledOnce());
    expect(answerAction.mock.calls[0]?.[0].request).toEqual({
      answers: [
        {
          field: "tags",
          value: {
            cuisines: ["Irish"],
            difficulty: "medium",
            leftovers: "one_meal",
            mealTypes: ["lunch"],
            totalTimeBand: "30_to_60_minutes",
          },
        },
      ],
      expectedActionVersion: 3,
    });
  });
});

describe("structured recipe details", () => {
  it("preserves source wording, sections and unknown amounts alongside inactive time", () => {
    render(
      <RecipeDetails
        recipe={{
          ...emptyRecipeDetails,
          ingredients: [
            {
              ...recipeIngredientFromText("A handful of herbs"),
              group: "To finish",
            },
          ],
          instructions: [
            {
              ...recipeInstructionFromText("Leave to rest.", 1),
              group: "Resting",
              temperature: { unit: "C", value: 180 },
            },
          ],
          name: "Soup",
          notes: ["Refrigerate leftovers."],
          times: {
            ...emptyRecipeDetails.times,
            inactive: { seconds: 1200 },
            prep: { seconds: 0 },
          },
        }}
      />
    );
    expect(screen.getByText("A handful of herbs")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "To finish" })
    ).toBeInTheDocument();
    expect(screen.getByText("Quantity not provided")).toBeInTheDocument();
    expect(screen.getByText("Servings not provided")).toBeInTheDocument();
    expect(screen.getByText("20 minutes")).toBeInTheDocument();
    expect(screen.getByText("0 minutes")).toBeInTheDocument();
    expect(screen.getByText("180°C")).toBeInTheDocument();
    expect(screen.getByText("Refrigerate leftovers.")).toBeInTheDocument();
  });
});

it("saves structured ingredient corrections while retaining the source wording", async () => {
  const action = Schema.decodeUnknownSync(RecipeImportAction)({
    ...activeAction,
    review: { ...activeAction.review, editableFields: ["ingredients"] },
  });
  const answerAction = vi.fn<RecipeImportOperations["answerAction"]>(() =>
    Effect.succeed(requiresAction)
  );
  renderPage(
    makeOperations({
      answerAction,
      getAction: vi.fn(() => Effect.succeed(action)),
      getIntent: vi.fn(() => Effect.succeed(requiresAction)),
    })
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Recipe link" }),
    "https://www.tiktok.com/@cook/video/7390123456789012345"
  );
  await user.click(screen.getByRole("button", { name: "Import recipe" }));
  await user.click(await screen.findByText("Edit recipe details"));
  await user.click(screen.getByText("Ingredients", { selector: "summary" }));
  await user.click(screen.getByRole("button", { name: "Add amount" }));
  const amount = screen.getByRole("spinbutton", { name: "Amount" });
  await user.clear(amount);
  await user.type(amount, "600");
  await user.click(screen.getByRole("button", { name: "Save recipe details" }));
  await waitFor(() => expect(answerAction).toHaveBeenCalledOnce());
  expect(answerAction.mock.calls[0]?.[0].request.answers).toEqual([
    {
      field: "ingredients",
      value: [
        {
          ...recipeIngredientFromText("400 g beef"),
          quantity: { max: null, unit: null, value: 600 },
        },
      ],
    },
  ]);
  await user.click(screen.getByRole("button", { name: "Clear amount" }));
  await user.click(screen.getByRole("button", { name: "Save recipe details" }));
  await waitFor(() => expect(answerAction).toHaveBeenCalledTimes(2));
  expect(answerAction.mock.calls[1]?.[0].request.answers).toEqual([
    { field: "ingredients", value: [recipeIngredientFromText("400 g beef")] },
  ]);
});

it("lets a reviewer supply missing yield and waiting time with their own wording", async () => {
  const action = Schema.decodeUnknownSync(RecipeImportAction)({
    ...activeAction,
    review: { ...activeAction.review, editableFields: ["servings", "times"] },
  });
  const answerAction = vi.fn<RecipeImportOperations["answerAction"]>(() =>
    Effect.succeed(requiresAction)
  );
  renderPage(
    makeOperations({
      answerAction,
      getAction: vi.fn(() => Effect.succeed(action)),
      getIntent: vi.fn(() => Effect.succeed(requiresAction)),
    })
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Recipe link" }),
    "https://www.tiktok.com/@cook/video/7390123456789012345"
  );
  await user.click(screen.getByRole("button", { name: "Import recipe" }));
  await user.click(await screen.findByText("Edit recipe details"));
  await user.click(
    screen.getByText("Servings or yield", { selector: "summary" })
  );
  await user.click(
    screen.getByRole("button", { name: "Add servings or yield" })
  );
  await user.type(
    screen.getByRole("textbox", { name: "Original source wording" }),
    "Serves four"
  );
  const amount = screen.getByRole("spinbutton", { name: "Amount" });
  await user.clear(amount);
  await user.type(amount, "4");
  await user.click(screen.getByText("Cooking times", { selector: "summary" }));
  await user.click(
    screen.getByRole("button", { name: "Add waiting or resting" })
  );
  const minutes = screen.getByRole("spinbutton", { name: "Minutes" });
  await user.clear(minutes);
  await user.type(minutes, "30");
  await user.click(screen.getByRole("button", { name: "Save recipe details" }));
  await waitFor(() => expect(answerAction).toHaveBeenCalledOnce());
  expect(answerAction.mock.calls[0]?.[0].request.answers).toEqual([
    {
      field: "servings",
      value: { max: null, original: "Serves four", quantity: 4, unit: null },
    },
    {
      field: "times",
      value: { ...emptyRecipeDetails.times, inactive: { seconds: 1800 } },
    },
  ]);
});

it("displays corrected yield and dietary meaning separately from original source wording", () => {
  render(
    <RecipeDetails
      recipe={{
        ...emptyRecipeDetails,
        dietary: [
          {
            kind: "diet",
            name: "vegan",
            original: "Vegetarian",
            source: "provided",
            value: false,
          },
          {
            kind: "allergen",
            name: "milk",
            original: "Contains dairy",
            source: "provided",
            value: false,
          },
        ],
        ingredients: [recipeIngredientFromText("Salt")],
        instructions: [recipeInstructionFromText("Season.", 1)],
        name: "Soup",
        servings: {
          max: 8,
          original: "Serves 4",
          quantity: 6,
          unit: "servings",
        },
      }}
    />
  );
  expect(screen.getByText("Yield: 6–8 servings")).toBeInTheDocument();
  expect(screen.getByText("Source: Serves 4")).toBeInTheDocument();
  expect(screen.getByText("Diet: vegan — stated no")).toBeInTheDocument();
  expect(screen.getByText("Source: Vegetarian")).toBeInTheDocument();
  expect(
    screen.getByText("Allergen: milk — stated absent")
  ).toBeInTheDocument();
  expect(screen.getByText("Source: Contains dairy")).toBeInTheDocument();
});
