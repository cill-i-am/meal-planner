// @vitest-environment jsdom

import {
  Recipe,
  RecipeImportAction,
  RecipeImportIntentId,
  RecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import type { RecipeImportOperations } from "./operations.js";
import {
  recipeImportQueryKeys,
  switchRecipeImportProfile,
} from "./profile-query-isolation.js";
import { RecipeImportProfileAlias } from "./profiles.js";
import { RecipeImportPage } from "./recipe-import-page.js";

afterEach(cleanup);

const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "11111111-1111-4111-8111-111111111111"
);
const profileAlias = Schema.decodeUnknownSync(RecipeImportProfileAlias)("home");
const profileAliasB = Schema.decodeUnknownSync(RecipeImportProfileAlias)(
  "test-kitchen"
);
const profiles = [
  { alias: profileAlias, label: "Our household" },
  { alias: profileAliasB, label: "Test kitchen" },
] as const;
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
    readonly onProfileChange?: (
      nextAlias: typeof profileAlias
    ) => Promise<void>;
    readonly profileAlias?: typeof profileAlias;
    readonly queryClient?: QueryClient;
    readonly withRouter?: boolean;
  } = {}
) => {
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  const page = (
    <QueryClientProvider client={queryClient}>
      <RecipeImportPage
        {...(options.initialIntentId === undefined
          ? {}
          : { initialIntentId: options.initialIntentId })}
        makeRequestId={options.makeRequestId ?? makeRequestIdSequence()}
        onProfileChange={options.onProfileChange ?? (() => Promise.resolve())}
        operations={operations}
        pollIntervalMs={5}
        profileAlias={options.profileAlias ?? profileAlias}
        profiles={profiles}
      />
    </QueryClientProvider>
  );
  if (options.withRouter !== true) {
    return render(page);
  }

  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    component: () => page,
    getParentRoute: () => rootRoute,
    path: "/",
    validateSearch: (search: Record<string, unknown>) => search,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/?profile=home"] }),
    routeTree: rootRoute.addChildren([indexRoute]),
  });
  return render(<RouterProvider router={router} />);
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
    await screen.findByRole("textbox", { name: "Recipe link" }),
    sourceUrl
  );
  await user.click(screen.getByRole("button", { name: "Import recipe" }));
  return user;
};

interface LateMutationScenario {
  readonly initialIntent?: RecipeImportIntent;
  readonly operations: RecipeImportOperations;
  readonly pendingButtonName: string;
  readonly resolve: () => Promise<void>;
  readonly seed?: (queryClient: QueryClient) => void;
  readonly start: (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
}

const makeDeferred = <A,>() => {
  let resolveDeferred!: (value: A) => void;
  const promise = new Promise<A>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
};

const pendingIntentRead = () => new Promise<never>(() => {});

const seedReview = (queryClient: QueryClient) => {
  queryClient.setQueryData(
    recipeImportQueryKeys.action(profileAlias, intentId, actionId),
    activeAction
  );
};

const makeLateCreateScenario = (): LateMutationScenario => {
  const deferred = makeDeferred<typeof processing>();
  return {
    operations: makeOperations({
      create: () => deferred.promise,
      getIntent: pendingIntentRead,
    }),
    pendingButtonName: "Import recipe",
    resolve: async () => {
      deferred.resolve(processing);
      await deferred.promise;
    },
    start: async (user) => {
      await user.type(
        await screen.findByRole("textbox", { name: "Recipe link" }),
        sourceUrl
      );
      await user.click(screen.getByRole("button", { name: "Import recipe" }));
    },
  };
};

const makeLateAnswerScenario = (): LateMutationScenario => {
  const deferred = makeDeferred<typeof requiresAction>();
  return {
    initialIntent: requiresAction,
    operations: makeOperations({
      answerAction: () => deferred.promise,
      getIntent: pendingIntentRead,
    }),
    pendingButtonName: "Save recipe name",
    resolve: async () => {
      deferred.resolve(requiresAction);
      await deferred.promise;
    },
    seed: seedReview,
    start: async (user) => {
      await user.click(
        await screen.findByRole("button", { name: "Save recipe name" })
      );
    },
  };
};

const makeLateConfirmScenario = (): LateMutationScenario => {
  const deferred = makeDeferred<typeof succeeded>();
  return {
    initialIntent: requiresAction,
    operations: makeOperations({
      confirmAction: () => deferred.promise,
      getIntent: pendingIntentRead,
    }),
    pendingButtonName: "Confirm recipe",
    resolve: async () => {
      deferred.resolve(succeeded);
      await deferred.promise;
    },
    seed: seedReview,
    start: async (user) => {
      await user.click(
        await screen.findByRole("button", { name: "Confirm recipe" })
      );
    },
  };
};

const makeLateCancelScenario = (): LateMutationScenario => {
  const deferred = makeDeferred<typeof cancelled>();
  return {
    initialIntent: processing,
    operations: makeOperations({
      cancel: () => deferred.promise,
      getIntent: pendingIntentRead,
    }),
    pendingButtonName: "Cancel import",
    resolve: async () => {
      deferred.resolve(cancelled);
      await deferred.promise;
    },
    start: async (user) => {
      await user.click(
        await screen.findByRole("button", { name: "Cancel import" })
      );
    },
  };
};

const lateMutationScenarios = [
  ["creation", makeLateCreateScenario],
  ["review answer", makeLateAnswerScenario],
  ["confirmation", makeLateConfirmScenario],
  ["cancellation", makeLateCancelScenario],
] as const;

const renderProfileSwitchHarness = (
  queryClient: QueryClient,
  scenario: LateMutationScenario
) => {
  const viewHolder: { current: ReturnType<typeof render> | null } = {
    current: null,
  };
  const renderProfile = (activeProfileAlias: typeof profileAlias) => (
    <QueryClientProvider client={queryClient}>
      <RecipeImportPage
        {...(activeProfileAlias === profileAlias &&
        scenario.initialIntent !== undefined
          ? { initialIntentId: scenario.initialIntent.id }
          : {})}
        key={activeProfileAlias}
        makeRequestId={makeRequestIdSequence()}
        onProfileChange={(nextAlias) =>
          switchRecipeImportProfile({
            currentAlias: activeProfileAlias,
            navigate: async (navigatedAlias) => {
              if (viewHolder.current === null) {
                throw new Error("Profile switch harness is not mounted.");
              }
              viewHolder.current.rerender(renderProfile(navigatedAlias));
            },
            nextAlias,
            queryClient,
          })
        }
        operations={scenario.operations}
        pollIntervalMs={5}
        profileAlias={activeProfileAlias}
        profiles={profiles}
      />
    </QueryClientProvider>
  );
  viewHolder.current = render(renderProfile(profileAlias));
  return userEvent.setup();
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
      }),
      { withRouter: true }
    );
    await submit();
    expect(
      await screen.findByRole("heading", {
        name: "An existing import is already in progress",
      })
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View existing import" })
    ).toHaveAttribute(
      "href",
      `/?profile=${profileAlias}&intentId=${redirectedIntentId}`
    );
  });

  it("loads an app-linked canonical intent without creating another import", async () => {
    const getIntentRequests: Parameters<
      RecipeImportOperations["getIntent"]
    >[0][] = [];
    let createRequests = 0;
    renderPage(
      makeOperations({
        create: async () => {
          createRequests += 1;
          return processing;
        },
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
    expect(createRequests).toBe(0);
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

  it("exposes the active household in a keyboard-operable labeled switcher", async () => {
    const profileChanges: (typeof profileAlias)[] = [];
    renderPage(makeOperations(), {
      onProfileChange: async (nextAlias) => {
        profileChanges.push(nextAlias);
      },
    });
    const user = userEvent.setup();
    const switcher = screen.getByRole("combobox", { name: "Household" });

    expect(switcher).toHaveValue(profileAlias);
    expect(screen.getByText("Viewing Our household")).toBeVisible();
    await user.tab();
    expect(switcher).toHaveFocus();
    await user.selectOptions(switcher, profileAliasB);

    expect(profileChanges).toEqual([profileAliasB]);
  });

  it("cannot render an old household intent or recipe after the keyed profile boundary switches", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      recipeImportQueryKeys.intent(profileAlias, intentId),
      succeeded
    );
    queryClient.setQueryData(
      recipeImportQueryKeys.recipe(profileAlias, recipeId),
      recipe
    );
    const renderProfile = (
      activeProfileAlias: typeof profileAlias,
      operations: RecipeImportOperations
    ) => (
      <QueryClientProvider client={queryClient}>
        <RecipeImportPage
          initialIntentId={intentId}
          key={activeProfileAlias}
          makeRequestId={makeRequestIdSequence()}
          onProfileChange={() => Promise.resolve()}
          operations={operations}
          pollIntervalMs={5}
          profileAlias={activeProfileAlias}
          profiles={profiles}
        />
      </QueryClientProvider>
    );
    const view = render(renderProfile(profileAlias, makeOperations()));

    expect(
      await screen.findByRole("heading", { name: "Recipe saved" })
    ).toBeVisible();
    expect(screen.getByText("Roasted aubergine bake")).toBeVisible();

    view.rerender(
      renderProfile(
        profileAliasB,
        makeOperations({ getIntent: async () => new Promise<never>(() => {}) })
      )
    );

    expect(
      screen.queryByText("Roasted aubergine bake")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Recipe saved" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Viewing Test kitchen")).toBeVisible();
  });

  it("cannot render an old household action after the keyed profile boundary switches", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      recipeImportQueryKeys.intent(profileAlias, intentId),
      requiresAction
    );
    queryClient.setQueryData(
      recipeImportQueryKeys.action(profileAlias, intentId, actionId),
      activeAction
    );
    const pendingOperations = makeOperations({
      getIntent: async () => new Promise<never>(() => {}),
    });
    const renderProfile = (activeProfileAlias: typeof profileAlias) => (
      <QueryClientProvider client={queryClient}>
        <RecipeImportPage
          initialIntentId={intentId}
          key={activeProfileAlias}
          makeRequestId={makeRequestIdSequence()}
          onProfileChange={() => Promise.resolve()}
          operations={pendingOperations}
          pollIntervalMs={5}
          profileAlias={activeProfileAlias}
          profiles={profiles}
        />
      </QueryClientProvider>
    );
    const view = render(renderProfile(profileAlias));

    expect(
      await screen.findByRole("heading", { name: "Review recipe" })
    ).toBeVisible();
    expect(screen.getByDisplayValue("Roasted aubergine bake")).toBeVisible();

    view.rerender(renderProfile(profileAliasB));

    expect(
      screen.queryByRole("heading", { name: "Review recipe" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Roasted aubergine bake")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Viewing Test kitchen")).toBeVisible();
  });

  it.each(lateMutationScenarios)(
    "keeps a late household A %s inert after switching to household B",
    async (_name, makeScenario) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const scenario = makeScenario();
      if (scenario.initialIntent !== undefined) {
        queryClient.setQueryData(
          recipeImportQueryKeys.intent(profileAlias, intentId),
          scenario.initialIntent
        );
      }
      scenario.seed?.(queryClient);
      const user = renderProfileSwitchHarness(queryClient, scenario);

      await scenario.start(user);
      expect(
        screen.getByRole("button", { name: scenario.pendingButtonName })
      ).toBeDisabled();
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Household" }),
        profileAliasB
      );
      expect(await screen.findByText("Viewing Test kitchen")).toBeVisible();
      await waitFor(() =>
        expect(
          queryClient.getQueriesData({
            queryKey: recipeImportQueryKeys.profile(profileAlias),
          })
        ).toEqual([])
      );

      await act(scenario.resolve);

      await waitFor(() =>
        expect(
          queryClient.getQueriesData({
            queryKey: recipeImportQueryKeys.profile(profileAlias),
          })
        ).toEqual([])
      );
      expect(screen.getByText("Viewing Test kitchen")).toBeVisible();
      expect(
        screen.queryByText("Roasted aubergine bake")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Working on your recipe" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Review recipe" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Recipe saved" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Import cancelled" })
      ).not.toBeInTheDocument();
    }
  );

  it("keeps a retired household A mutation inert when navigation rejects after keyed unmount", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const scenario = makeLateCancelScenario();
    queryClient.setQueryData(
      recipeImportQueryKeys.intent(profileAlias, intentId),
      processing
    );
    const viewHolder: { current: ReturnType<typeof render> | null } = {
      current: null,
    };
    const renderProfile = (activeProfileAlias: typeof profileAlias) => (
      <QueryClientProvider client={queryClient}>
        <RecipeImportPage
          {...(activeProfileAlias === profileAlias
            ? { initialIntentId: intentId }
            : {})}
          key={activeProfileAlias}
          makeRequestId={makeRequestIdSequence()}
          onProfileChange={async (nextAlias) => {
            if (viewHolder.current === null) {
              throw new Error("Profile switch harness is not mounted.");
            }
            viewHolder.current.rerender(renderProfile(nextAlias));
            queryClient.removeQueries({
              queryKey: recipeImportQueryKeys.profile(profileAlias),
            });
            throw new Error(
              "Navigation rejected after the keyed boundary moved."
            );
          }}
          operations={scenario.operations}
          pollIntervalMs={5}
          profileAlias={activeProfileAlias}
          profiles={profiles}
        />
      </QueryClientProvider>
    );
    viewHolder.current = render(renderProfile(profileAlias));
    const user = userEvent.setup();

    await scenario.start(user);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Household" }),
      profileAliasB
    );
    expect(await screen.findByText("Viewing Test kitchen")).toBeVisible();
    expect(
      queryClient.getQueriesData({
        queryKey: recipeImportQueryKeys.profile(profileAlias),
      })
    ).toEqual([]);

    await act(scenario.resolve);

    await waitFor(() =>
      expect(
        queryClient.getQueriesData({
          queryKey: recipeImportQueryKeys.profile(profileAlias),
        })
      ).toEqual([])
    );
    expect(screen.getByText("Viewing Test kitchen")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Import cancelled" })
    ).not.toBeInTheDocument();
  });
});
