import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeRecipeImportProfileSession,
  recipeImportQueryKeys,
  switchRecipeImportProfile,
} from "./profile-query-isolation.js";
import { RecipeImportProfileAlias } from "./profiles.js";

const profileA = Schema.decodeUnknownSync(RecipeImportProfileAlias)("home");
const profileB = Schema.decodeUnknownSync(RecipeImportProfileAlias)(
  "test-kitchen"
);

describe("recipe import profile query isolation", () => {
  it("keeps a switching session retired across cleanup and remount", () => {
    const session = makeRecipeImportProfileSession();
    session.mount();
    session.beginSwitch();
    session.unmount();
    session.mount();

    expect(session.isActive()).toBe(false);
  });

  it("does not recover a retired session after it has unmounted", () => {
    const session = makeRecipeImportProfileSession();
    session.mount();
    session.beginSwitch();
    session.unmount();
    session.recover();

    expect(session.isActive()).toBe(false);
  });

  it("recovers a failed switch while the same session remains mounted", () => {
    const session = makeRecipeImportProfileSession();
    session.mount();
    session.beginSwitch();
    session.recover();

    expect(session.isActive()).toBe(true);
  });

  it("keeps a StrictMode-like initial remount active", () => {
    const session = makeRecipeImportProfileSession();
    session.mount();
    session.unmount();
    session.mount();

    expect(session.isActive()).toBe(true);
  });

  it("puts the profile alias first in every exact query key", () => {
    expect(recipeImportQueryKeys.intent(profileA, "intent-a")).toEqual([
      profileA,
      "recipe-import-intent",
      "intent-a",
    ]);
    expect(recipeImportQueryKeys.actions(profileA, "intent-a")).toEqual([
      profileA,
      "recipe-import-action",
      "intent-a",
    ]);
    expect(
      recipeImportQueryKeys.action(profileA, "intent-a", "action-a")
    ).toEqual([profileA, "recipe-import-action", "intent-a", "action-a"]);
    expect(recipeImportQueryKeys.recipe(profileA, "recipe-a")).toEqual([
      profileA,
      "recipe",
      "recipe-a",
    ]);
  });

  it("cancels old polling before navigation and removes only the old cache after observers detach", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const oldKey = recipeImportQueryKeys.intent(profileA, "intent-a");
    const newKey = recipeImportQueryKeys.intent(profileB, "intent-b");
    queryClient.setQueryData(oldKey, { household: "A" });
    queryClient.setQueryData(newKey, { household: "B" });
    let oldPollAborted = false;
    let oldPollStarted!: () => void;
    const pollStarted = new Promise<void>((resolve) => {
      oldPollStarted = resolve;
    });
    const observer = new QueryObserver(queryClient, {
      queryFn: ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          oldPollStarted();
          signal.addEventListener("abort", () => {
            oldPollAborted = true;
            reject(signal.reason);
          });
        }),
      queryKey: oldKey,
      refetchInterval: 5,
      staleTime: 0,
    });
    const unsubscribe = observer.subscribe(() => null);
    await pollStarted;
    const order: string[] = [];

    await switchRecipeImportProfile({
      currentAlias: profileA,
      navigate: async (nextAlias) => {
        order.push(`navigate:${nextAlias}`);
        expect(oldPollAborted).toBe(true);
        expect(queryClient.getQueryData(oldKey)).toEqual({ household: "A" });
        unsubscribe();
      },
      nextAlias: profileB,
      queryClient,
    });
    order.push("complete");

    expect(order).toEqual([`navigate:${profileB}`, "complete"]);
    expect(queryClient.getQueryData(oldKey)).toBeUndefined();
    expect(queryClient.getQueryData(newKey)).toEqual({ household: "B" });
  });
});
