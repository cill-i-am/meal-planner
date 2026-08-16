// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  ApprovalView,
  ImportProgressView,
  RecipeBankView,
  RecipeReviewView,
} from "./contracts.js";
import type { RecipeImportOperations } from "./contracts.js";
import { RecipeImportPage } from "./recipe-import-page.js";

afterEach(cleanup);

const ImportId = "11111111-1111-4111-8111-111111111111";
const RequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SourceUrl = "https://www.tiktok.com/@kitchen/video/7390123456789012345";
const PocRawSecret = "raw-provider-secret-that-must-never-render";

const progress = (kind: "queued" | "acquiring" | "needs_review") =>
  Schema.decodeUnknownSync(ImportProgressView)({
    ...(kind === "needs_review" ? { draftId: ImportId } : {}),
    importId: ImportId,
    status: { kind },
  });

const review = Schema.decodeUnknownSync(RecipeReviewView)({
  draftId: ImportId,
  ingredientLines: ["2 aubergines", "400 g chopped tomatoes"],
  instructions: ["Roast the aubergines.", "Layer and bake."],
  name: "Roasted aubergine bake",
  source: { label: "TikTok", link: SourceUrl },
  status: "needs_review",
  version: 1,
});

const saved = Schema.decodeUnknownSync(RecipeBankView)({
  recipe: {
    ingredientLines: review.ingredientLines,
    instructions: review.instructions,
    name: review.name,
    recipeId: ImportId,
    source: review.source,
    version: 2,
  },
});

const makeOperations = (
  overrides: Partial<RecipeImportOperations> = {}
): RecipeImportOperations => ({
  approve: async (input) => ({
    ok: true,
    value: Schema.decodeUnknownSync(ApprovalView)({
      draftId: input.draftId,
      outcome: "applied",
      status: "approved",
      version: 2,
    }),
  }),
  listBank: async () => ({ ok: true, value: saved }),
  loadReview: async () => ({ ok: true, value: review }),
  poll: async () => ({ ok: true, value: progress("needs_review") }),
  submit: async () => ({ ok: true, value: progress("queued") }),
  ...overrides,
});

const renderPage = (
  operations: RecipeImportOperations,
  makeRequestId = () => RequestId
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecipeImportPage
        makeRequestId={makeRequestId}
        operations={operations}
        pollIntervalMs={5}
      />
    </QueryClientProvider>
  );
};

const submitWithKeyboard = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("textbox", { name: "Recipe link" }));
  await user.type(
    screen.getByRole("textbox", { name: "Recipe link" }),
    SourceUrl
  );
  await user.keyboard("{Enter}");
  return user;
};

describe("RecipeImportPage", () => {
  it("renders the empty, keyboard-ready form with accessible names", () => {
    renderPage(makeOperations());
    expect(
      screen.getByRole("heading", { name: "Import a recipe" })
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Recipe link" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create draft" })).toBeVisible();
    expect(screen.getByText("One link at a time.")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Review draft" })
    ).not.toBeInTheDocument();
  });

  it("shows a loading state without inventing a percentage or ETA", async () => {
    let resolveSubmit!: (
      value: Awaited<ReturnType<RecipeImportOperations["submit"]>>
    ) => void;
    const pending = new Promise<
      Awaited<ReturnType<RecipeImportOperations["submit"]>>
    >((resolve) => {
      resolveSubmit = resolve;
    });
    renderPage(makeOperations({ submit: () => pending }));
    await submitWithKeyboard();

    expect(
      screen.getByRole("heading", { name: "Working on your recipe" })
    ).toBeVisible();
    expect(
      screen.queryByText(/(?:\d+%|\bminutes? remaining\b|\bETA\b)/iu)
    ).not.toBeInTheDocument();
    resolveSubmit({ ok: true, value: progress("queued") });
  });

  it("polls and announces a truthful processing stage", async () => {
    renderPage(
      makeOperations({
        poll: async () => ({ ok: true, value: progress("acquiring") }),
      })
    );
    await submitWithKeyboard();

    expect(
      await screen.findByRole("heading", { name: "Working on your recipe" })
    ).toBeVisible();
    expect(
      await screen.findByText("Getting the source", {
        selector: ".status-line",
      })
    ).toBeVisible();
  });

  it("stops rendering processing when polling fails after submit", async () => {
    renderPage(
      makeOperations({
        poll: async () => ({
          error: {
            code: "unavailable",
            message:
              "Recipe importing is temporarily unavailable. Please try again.",
            retryable: true,
          },
          ok: false,
        }),
      })
    );
    await submitWithKeyboard();

    expect(
      await screen.findByRole("heading", {
        name: "This link couldn’t be imported",
      })
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Working on your recipe" })
    ).not.toBeInTheDocument();
  });

  it("reviews one draft, approves it, and renders one matching bank result", async () => {
    let approved = false;
    const operations = makeOperations({
      approve: async (input) => {
        approved = true;
        return {
          ok: true,
          value: Schema.decodeUnknownSync(ApprovalView)({
            draftId: input.draftId,
            outcome: "applied",
            status: "approved",
            version: 2,
          }),
        };
      },
      listBank: async () => ({
        ok: true,
        value: approved
          ? saved
          : Schema.decodeUnknownSync(RecipeBankView)({ recipe: null }),
      }),
    });
    renderPage(operations);
    const user = await submitWithKeyboard();

    expect(
      await screen.findByRole("heading", { name: "Review draft" })
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ingredients" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Method" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Approve recipe" }));

    expect(
      await screen.findByRole("heading", { name: "Recipe saved" })
    ).toBeVisible();
    expect(screen.getByText("Added to Recipe Bank.")).toBeVisible();
    expect(screen.getAllByText("Roasted aubergine bake")).toHaveLength(1);
  });

  it("replays an ambiguous approval with the same mutation identifier", async () => {
    const requestIds = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ];
    const approvalIds: string[] = [];
    let approved = false;
    const operations = makeOperations({
      approve: async (input) => {
        approvalIds.push(input.mutationId);
        if (approvalIds.length === 1) {
          return {
            error: {
              code: "unavailable",
              message:
                "Recipe importing is temporarily unavailable. Please try again.",
              retryable: true,
            },
            ok: false,
          };
        }
        approved = true;
        return {
          ok: true,
          value: Schema.decodeUnknownSync(ApprovalView)({
            draftId: input.draftId,
            outcome: "replayed",
            status: "approved",
            version: 2,
          }),
        };
      },
      listBank: async () => ({
        ok: true,
        value: approved
          ? saved
          : Schema.decodeUnknownSync(RecipeBankView)({ recipe: null }),
      }),
    });
    renderPage(operations, () => requestIds.shift() ?? RequestId);
    const user = await submitWithKeyboard();

    await user.click(
      await screen.findByRole("button", { name: "Approve recipe" })
    );
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { name: "Recipe saved" })
    ).toBeVisible();
    expect(approvalIds).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
  });

  it("shows only allowlisted safe failure text", async () => {
    renderPage(
      makeOperations({
        submit: async () => ({
          error: {
            code: "unavailable",
            message:
              "Recipe importing is temporarily unavailable. Please try again.",
            retryable: true,
          },
          ok: false,
        }),
      })
    );
    await submitWithKeyboard();

    expect(
      await screen.findByRole("heading", {
        name: "This link couldn’t be imported",
      })
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(document.body.textContent).not.toContain("providerPayload");
    expect(document.body.textContent).not.toContain(PocRawSecret);
  });
});
