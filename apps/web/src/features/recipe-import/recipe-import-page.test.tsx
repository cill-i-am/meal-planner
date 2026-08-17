// @vitest-environment jsdom

import {
  Recipe,
  RecipeImportAction,
  RecipeImportIntentId,
  RecipeImportIntent,
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
const recipeId = "22222222-2222-4222-8222-222222222222";
const actionId = "a".repeat(64);
const sourceUrl = "https://www.tiktok.com/@kitchen/video/7390123456789012345";
const defaultRequestIds = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
];
const timestamp = "2026-08-16T00:00:00.000Z";
const links = {
  self: `/v1/recipe-import-intents/${intentId}`,
  timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
};
const recipeFields = {
  author: null,
  category: null,
  cookTimeMinutes: null,
  cuisine: null,
  description: null,
  ingredientLines: ["2 aubergines", "400 g chopped tomatoes"],
  ingredientQuantities: null,
  ingredientUnits: null,
  instructions: ["Roast the aubergines.", "Layer and bake."],
  name: "Roasted aubergine bake",
  nutrition: null,
  prepTimeMinutes: null,
  temperatureCelsius: null,
  tools: null,
  totalTimeMinutes: null,
  yield: null,
};

const processing = Schema.decodeUnknownSync(RecipeImportIntent)({
  activity: { type: "working" },
  createdAt: timestamp,
  id: intentId,
  intentVersion: 1,
  links,
  object: "recipe_import_intent",
  processing: { startedAt: timestamp, type: "resolving_source" },
  source: { kind: "tiktok", resolution: "pending" },
  status: "processing",
  updatedAt: timestamp,
});
const requiresAction = Schema.decodeUnknownSync(RecipeImportIntent)({
  action: {
    id: actionId,
    link: `/v1/recipe-import-intents/${intentId}/actions/${actionId}`,
    type: "review_recipe",
  },
  createdAt: timestamp,
  id: intentId,
  intentVersion: 2,
  links,
  object: "recipe_import_intent",
  source: {
    canonicalUrl: sourceUrl,
    kind: "tiktok",
    resolution: "resolved",
  },
  status: "requires_action",
  updatedAt: timestamp,
});
const succeeded = Schema.decodeUnknownSync(RecipeImportIntent)({
  completedAt: timestamp,
  createdAt: timestamp,
  id: intentId,
  intentVersion: 3,
  links,
  object: "recipe_import_intent",
  result: { recipeId },
  source: {
    canonicalUrl: sourceUrl,
    kind: "tiktok",
    resolution: "resolved",
  },
  status: "succeeded",
  updatedAt: timestamp,
});
const cancelled = Schema.decodeUnknownSync(RecipeImportIntent)({
  cancelledAt: timestamp,
  createdAt: timestamp,
  id: intentId,
  intentVersion: 2,
  links,
  object: "recipe_import_intent",
  source: { kind: "tiktok", resolution: "pending" },
  status: "cancelled",
  updatedAt: timestamp,
});
const activeAction = Schema.decodeUnknownSync(RecipeImportAction)({
  actionVersion: 1,
  id: actionId,
  intentId,
  object: "recipe_import_action",
  review: {
    answers: [],
    blockers: { invalidFields: [], unresolvedRequiredFields: [] },
    editableFields: ["name"],
    recipe: recipeFields,
    tags: null,
  },
  status: "active",
  type: "review_recipe",
});
const recipe = Schema.decodeUnknownSync(Recipe)({
  id: recipeId,
  object: "recipe",
  recipe: recipeFields,
  tags: {
    cuisines: ["Italian"],
    dietaryFit: "household_match",
    difficulty: "easy",
    leftovers: "one_meal",
    mealTypes: ["dinner"],
    totalTimeBand: "30_to_60_minutes",
  },
});

const makeRequestIdSequence = (requestIds = defaultRequestIds) => {
  let index = 0;
  return () => {
    const requestId =
      requestIds[index] ?? "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    index += 1;
    return requestId;
  };
};

const renderPage = (
  operations: RecipeImportOperations,
  options: {
    readonly initialIntentId?: RecipeImportIntent["id"];
    readonly makeRequestId?: () => string;
  } = {}
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecipeImportPage
        {...(options.initialIntentId === undefined
          ? {}
          : { initialIntentId: options.initialIntentId })}
        makeRequestId={options.makeRequestId ?? makeRequestIdSequence()}
        operations={operations}
        pollIntervalMs={5}
      />
    </QueryClientProvider>
  );
};

const makeOperations = (
  overrides: Partial<RecipeImportOperations> = {}
): RecipeImportOperations => ({
  answerAction: async () => requiresAction,
  cancel: async () => cancelled,
  confirmAction: async () => succeeded,
  create: async () => processing,
  getAction: async () => activeAction,
  getIntent: async () => requiresAction,
  getRecipe: async () => recipe,
  ...overrides,
});

const submit = async () => {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Recipe link" }),
    sourceUrl
  );
  await user.click(screen.getByRole("button", { name: "Import recipe" }));
  return user;
};

describe("RecipeImportPage", () => {
  it("renders the immediate admission state, then the truthful canonical processing stage", async () => {
    let resolveCreate!: (value: typeof processing) => void;
    const pendingCreate = new Promise<typeof processing>((resolve) => {
      resolveCreate = resolve;
    });
    renderPage(
      makeOperations({
        create: async () => pendingCreate,
        getIntent: async () => new Promise<never>(() => {}),
      })
    );
    await submit();

    expect(
      screen.getByRole("heading", { name: "Working on your recipe" })
    ).toBeVisible();
    expect(screen.getByText("Creating your import")).toBeVisible();
    resolveCreate(processing);

    expect(await screen.findByText("Resolving the link")).toBeVisible();
  });

  it("confirms the canonical action, then fetches and shows the saved recipe", async () => {
    const recipeRequests: Parameters<RecipeImportOperations["getRecipe"]>[0][] =
      [];
    renderPage(
      makeOperations({
        getRecipe: async (input) => {
          recipeRequests.push(input);
          return recipe;
        },
      })
    );
    const user = await submit();

    expect(
      await screen.findByRole("heading", { name: "Review recipe" })
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ingredients" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm recipe" }));

    expect(
      await screen.findByRole("heading", { name: "Recipe saved" })
    ).toBeVisible();
    expect(screen.getByText("Roasted aubergine bake")).toBeVisible();
    expect(recipeRequests).toEqual([{ recipeId }]);
  });

  it("submits an edited name when the generated action exposes that field", async () => {
    const answerRequests: Parameters<
      RecipeImportOperations["answerAction"]
    >[0][] = [];
    const updatedAction = Schema.decodeUnknownSync(RecipeImportAction)({
      ...activeAction,
      actionVersion: 2,
      review: {
        ...activeAction.review,
        answers: [{ field: "name", value: "Smoky aubergine bake" }],
        recipe: { ...recipeFields, name: "Smoky aubergine bake" },
      },
    });
    let action = activeAction;
    const answerAction: RecipeImportOperations["answerAction"] = async (
      input
    ) => {
      answerRequests.push(input);
      action = updatedAction;
      return requiresAction;
    };
    renderPage(
      makeOperations({ answerAction, getAction: async () => action }),
      {
        makeRequestId: makeRequestIdSequence([
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ]),
      }
    );
    const user = await submit();

    await screen.findByRole("heading", { name: "Review recipe" });
    const name = screen.getByRole("textbox", { name: "Recipe name" });
    await user.clear(name);
    await user.type(name, "Smoky aubergine bake");
    await user.click(screen.getByRole("button", { name: "Save recipe name" }));

    await waitFor(() => expect(answerRequests).toHaveLength(1));
    expect(answerRequests).toEqual([
      {
        actionId,
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        intentId,
        request: {
          answers: [{ field: "name", value: "Smoky aubergine bake" }],
          expectedActionVersion: activeAction.actionVersion,
        },
      },
    ]);
    expect(
      await screen.findByRole("heading", { name: "Smoky aubergine bake" })
    ).toBeVisible();
    expect(screen.getByText("Version 2")).toBeVisible();
  });

  it("does not retry a failed confirm action and keeps its idempotency key", async () => {
    const confirmRequests: Parameters<
      RecipeImportOperations["confirmAction"]
    >[0][] = [];
    const unsafeDetail = "upstream confirmation detail";
    const confirmAction: RecipeImportOperations["confirmAction"] = async (
      input
    ) => {
      confirmRequests.push(input);
      throw new Error(unsafeDetail);
    };
    renderPage(makeOperations({ confirmAction }), {
      makeRequestId: makeRequestIdSequence([
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ]),
    });
    const user = await submit();

    await screen.findByRole("heading", { name: "Review recipe" });
    await user.click(screen.getByRole("button", { name: "Confirm recipe" }));

    expect(
      await screen.findByRole("heading", {
        name: "This import couldn’t be completed",
      })
    ).toBeVisible();
    expect(screen.queryByText(unsafeDetail)).not.toBeInTheDocument();
    expect(confirmRequests).toEqual([
      {
        actionId,
        idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        intentId,
        request: { expectedActionVersion: activeAction.actionVersion },
      },
    ]);
  });

  it("renders a safe alert when polling the canonical intent fails", async () => {
    const unsafeDetail = "provider response body that must not render";
    renderPage(
      makeOperations({
        create: async () => processing,
        getIntent: async () => {
          throw new Error(unsafeDetail);
        },
      })
    );
    await submit();

    expect(
      await screen.findByRole("heading", {
        name: "This import couldn’t be completed",
      })
    ).toBeVisible();
    expect(screen.queryByText(unsafeDetail)).not.toBeInTheDocument();
  });

  it("renders the canonical failed state without an upstream error", async () => {
    const failed = Schema.decodeUnknownSync(RecipeImportIntent)({
      createdAt: timestamp,
      error: {
        code: "source_unavailable",
        message: "This source is not available.",
        recovery: "create_new_intent",
      },
      failedAt: timestamp,
      id: intentId,
      intentVersion: 2,
      links,
      object: "recipe_import_intent",
      source: { kind: "tiktok", resolution: "pending" },
      status: "failed",
      updatedAt: timestamp,
    });
    renderPage(
      makeOperations({
        create: async () => failed,
        getIntent: async () => failed,
      })
    );
    await submit();

    expect(
      await screen.findByRole("heading", {
        name: "This link couldn’t be imported",
      })
    ).toBeVisible();
    expect(screen.getByText("This source is not available.")).toBeVisible();
  });

  it("renders a redirected intent with an app link to the canonical intent", async () => {
    const redirectedIntentId = "33333333-3333-4333-8333-333333333333";
    const redirectedIntentLink = `/v1/recipe-import-intents/${redirectedIntentId}`;
    const redirected = Schema.decodeUnknownSync(RecipeImportIntent)({
      createdAt: timestamp,
      id: intentId,
      intentVersion: 1,
      links,
      object: "recipe_import_intent",
      redirect: {
        intentId: redirectedIntentId,
        link: redirectedIntentLink,
      },
      redirectedAt: timestamp,
      source: {
        canonicalUrl: sourceUrl,
        kind: "tiktok",
        resolution: "resolved",
      },
      status: "redirected",
      updatedAt: timestamp,
    });
    renderPage(
      makeOperations({
        create: async () => redirected,
        getIntent: async () => redirected,
      })
    );
    await submit();
    expect(
      await screen.findByRole("heading", {
        name: "An existing import is already in progress",
      })
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View existing import" })
    ).toHaveAttribute("href", `/?intentId=${redirectedIntentId}`);
  });

  it("loads an app-linked canonical intent without creating another import", async () => {
    const getIntentRequests: Parameters<
      RecipeImportOperations["getIntent"]
    >[0][] = [];
    const create = vi.fn(makeOperations().create);
    renderPage(
      makeOperations({
        create,
        getIntent: async (input) => {
          getIntentRequests.push(input);
          return requiresAction;
        },
      }),
      { initialIntentId: intentId }
    );

    expect(
      await screen.findByRole("heading", { name: "Review recipe" })
    ).toBeVisible();
    expect(getIntentRequests).toEqual([{ intentId }]);
    expect(create).not.toHaveBeenCalled();
  });

  it("cancels the current processing intent with its canonical version and renders cancellation", async () => {
    const cancelRequests: Parameters<RecipeImportOperations["cancel"]>[0][] =
      [];
    renderPage(
      makeOperations({
        cancel: async (input) => {
          cancelRequests.push(input);
          return cancelled;
        },
        getIntent: async () => new Promise<never>(() => {}),
      }),
      {
        makeRequestId: makeRequestIdSequence([
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ]),
      }
    );
    const user = await submit();

    await user.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(
      await screen.findByRole("heading", { name: "Import cancelled" })
    ).toBeVisible();
    expect(cancelRequests).toEqual([
      {
        idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        intentId,
        request: { expectedIntentVersion: processing.intentVersion },
      },
    ]);
  });

  it("validates the source link accessibly before admission", async () => {
    renderPage(makeOperations());
    const user = userEvent.setup();
    const source = screen.getByRole("textbox", { name: "Recipe link" });

    expect(source).toHaveAttribute("autocomplete", "url");
    await user.type(source, "http://not-public.example/recipe");
    await user.tab();

    expect(
      await screen.findByText("Enter an absolute HTTPS recipe link.")
    ).toBeVisible();
    expect(source).toHaveAttribute("aria-invalid", "true");
  });
});
