// @vitest-environment jsdom

import {
  RecipeImportIntent,
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
const processing = Schema.decodeUnknownSync(RecipeImportIntent)({
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
});
