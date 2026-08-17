import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  redirect,
  useLoaderData,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { Schema } from "effect";

import {
  canonicalizeRecipeImportSearch,
  decodeRecipeImportSearch,
  recipeImportProfileSwitchSearch,
  recipeImportPageSessionKey,
} from "../features/recipe-import/navigation.js";
import type { RecipeImportSearch } from "../features/recipe-import/navigation.js";
import { makeRecipeImportOperations } from "../features/recipe-import/operations.js";
import type { RecipeImportServerOperations } from "../features/recipe-import/operations.js";
import { switchRecipeImportProfile } from "../features/recipe-import/profile-query-isolation.js";
import { RecipeImportPublicProfileConfiguration } from "../features/recipe-import/profiles.js";
import { RecipeImportPage } from "../features/recipe-import/recipe-import-page.js";
import {
  answerRecipeImportAction,
  cancelRecipeImportIntent,
  confirmRecipeImportAction,
  createRecipeImportIntent,
  getImportedRecipe,
  getRecipeImportAction,
  getRecipeImportIntent,
  getRecipeImportProfileConfiguration,
} from "../features/recipe-import/server/functions.js";

const serverOperations: RecipeImportServerOperations = {
  answerAction: answerRecipeImportAction,
  cancel: cancelRecipeImportIntent,
  confirmAction: confirmRecipeImportAction,
  create: createRecipeImportIntent,
  getAction: getRecipeImportAction,
  getIntent: getRecipeImportIntent,
  getRecipe: getImportedRecipe,
};

const RecipeImportRoute = () => {
  const { configuration, profileAlias } = useLoaderData({ from: "/" });
  const { intentId } = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const queryClient = useQueryClient();
  const operations = makeRecipeImportOperations(profileAlias, serverOperations);

  return (
    <RecipeImportPage
      {...(intentId === undefined ? {} : { initialIntentId: intentId })}
      key={recipeImportPageSessionKey(profileAlias, intentId)}
      onProfileChange={(nextAlias) =>
        switchRecipeImportProfile({
          currentAlias: profileAlias,
          navigate: async (alias) => {
            await navigate({
              search: (previous) =>
                recipeImportProfileSwitchSearch(previous, alias),
              to: "/",
            });
          },
          nextAlias,
          queryClient,
        })
      }
      operations={operations}
      profileAlias={profileAlias}
      profiles={configuration.profiles}
    />
  );
};

export const Route = createFileRoute("/")({
  component: RecipeImportRoute,
  loader: async ({ deps }: { deps: RecipeImportSearch }) => {
    const configuration = Schema.decodeUnknownSync(
      RecipeImportPublicProfileConfiguration,
      { onExcessProperty: "error" }
    )(await getRecipeImportProfileConfiguration());
    const canonicalSearch = canonicalizeRecipeImportSearch(configuration, deps);

    if (deps.profile !== canonicalSearch.profile) {
      throw redirect({
        replace: true,
        search: canonicalSearch,
        to: "/",
      });
    }

    return { configuration, profileAlias: canonicalSearch.profile };
  },
  loaderDeps: ({ search }) => ({
    intentId: search.intentId,
    profile: search.profile,
  }),
  validateSearch: decodeRecipeImportSearch,
});
