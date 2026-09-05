// @vitest-environment jsdom

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
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecipeImportOperations } from "./operations.js";
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
      author: null,
      category: null,
      cookTimeMinutes: null,
      cuisine: "Irish",
      description: null,
      ingredientLines: ["400 g beef"],
      ingredientQuantities: null,
      ingredientUnits: null,
      instructions: ["Simmer until tender."],
      name: "Irish stew",
      nutrition: null,
      prepTimeMinutes: null,
      temperatureCelsius: null,
      tools: null,
      totalTimeMinutes: null,
      yield: null,
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
    dietaryFit: "household_match",
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
  create: vi.fn(async () => processing),
  getAction: vi.fn(),
  getIntent: vi.fn(async () => processing),
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
      async (_input: Parameters<RecipeImportOperations["create"]>[0]) =>
        processing
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
        create: vi.fn(async () => {
          throw new Error("secret");
        }),
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
    const confirmAction = vi.fn<RecipeImportOperations["confirmAction"]>(
      async () => succeeded
    );
    const getRecipe = vi.fn(async () => savedRecipe);
    renderPage(
      makeOperations({
        confirmAction,
        create: vi.fn(async () => processing),
        getAction: vi.fn(async () => activeAction),
        getIntent: vi.fn(async () => requiresAction),
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
    expect(screen.getByText("Simmer until tender.")).toBeInTheDocument();

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
    const answerAction = vi.fn<RecipeImportOperations["answerAction"]>(
      async () => requiresAction
    );
    renderPage(
      makeOperations({
        answerAction,
        getAction: vi.fn(async () => action),
        getIntent: vi.fn(async () => requiresAction),
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
            dietaryFit: "household_match",
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
