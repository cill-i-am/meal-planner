import type { QueryClient } from "@tanstack/react-query";

import type { RecipeImportProfileAlias } from "./profiles.js";

export interface RecipeImportProfileSession {
  readonly beginSwitch: () => void;
  readonly isActive: () => boolean;
  readonly mount: () => void;
  readonly recover: () => void;
  readonly unmount: () => void;
}

/** Keep a retired profile inert without mistaking a StrictMode remount for a switch. */
export const makeRecipeImportProfileSession =
  (): RecipeImportProfileSession => {
    let mounted = false;
    let retired = false;

    return {
      beginSwitch: () => {
        retired = true;
      },
      isActive: () => mounted && !retired,
      mount: () => {
        mounted = true;
      },
      recover: () => {
        if (mounted) {
          retired = false;
        }
      },
      unmount: () => {
        mounted = false;
      },
    };
  };

export const recipeImportQueryKeys = {
  action: (
    profileAlias: RecipeImportProfileAlias,
    intentId: string | undefined,
    actionId: string | undefined
  ) => [profileAlias, "recipe-import-action", intentId, actionId] as const,
  actions: (
    profileAlias: RecipeImportProfileAlias,
    intentId: string | undefined
  ) => [profileAlias, "recipe-import-action", intentId] as const,
  intent: (
    profileAlias: RecipeImportProfileAlias,
    intentId: string | undefined
  ) => [profileAlias, "recipe-import-intent", intentId] as const,
  profile: (profileAlias: RecipeImportProfileAlias) => [profileAlias] as const,
  recipe: (
    profileAlias: RecipeImportProfileAlias,
    recipeId: string | undefined
  ) => [profileAlias, "recipe", recipeId] as const,
};

export const switchRecipeImportProfile = async ({
  currentAlias,
  navigate,
  nextAlias,
  queryClient,
}: {
  readonly currentAlias: RecipeImportProfileAlias;
  readonly navigate: (nextAlias: RecipeImportProfileAlias) => Promise<void>;
  readonly nextAlias: RecipeImportProfileAlias;
  readonly queryClient: QueryClient;
}) => {
  if (currentAlias === nextAlias) {
    return;
  }

  const oldProfileQueryKey = recipeImportQueryKeys.profile(currentAlias);
  await queryClient.cancelQueries({ queryKey: oldProfileQueryKey });
  await navigate(nextAlias);
  queryClient.removeQueries({ queryKey: oldProfileQueryKey });
};
