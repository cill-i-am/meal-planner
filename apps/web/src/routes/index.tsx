import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

import { AuthBoundary } from "../features/auth/auth-boundary.js";
import type { AuthBoundaryActions } from "../features/auth/auth-boundary.js";
import {
  authClient,
  requireAuthSuccess,
} from "../features/auth/auth-client.js";
import { deriveAuthBoundaryState } from "../features/auth/auth-state.js";
import { makeBrowserRecipeImportOperations } from "../features/recipe-import/browser-operations.js";
import {
  decodeRecipeImportSearch,
  recipeImportPageSessionKey,
} from "../features/recipe-import/navigation.js";
import { RecipeImportPage } from "../features/recipe-import/recipe-import-page.js";

const MealPlannerRoute = () => {
  const { intentId } = useSearch({ from: "/" });
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const organizations = authClient.useListOrganizations();
  const activeOrganization = authClient.useActiveOrganization();
  const operations = useMemo(() => makeBrowserRecipeImportOperations(), []);

  const signOut = async () => {
    await requireAuthSuccess(authClient.signOut());
    queryClient.clear();
  };
  const actions: AuthBoundaryActions = {
    createHousehold: async (input) => {
      await requireAuthSuccess(authClient.organization.create(input));
    },
    retry: async () => {
      await Promise.all([
        session.refetch(),
        organizations.refetch(),
        activeOrganization.refetch(),
      ]);
    },
    selectHousehold: async (organizationId) => {
      await requireAuthSuccess(
        authClient.organization.setActive({ organizationId })
      );
    },
    signIn: async (input) => {
      await requireAuthSuccess(authClient.signIn.email(input));
    },
    signOut,
    signUp: async (input) => {
      await requireAuthSuccess(authClient.signUp.email(input));
    },
  };

  const state = deriveAuthBoundaryState({
    activeOrganization,
    organizations,
    session,
  });

  return (
    <AuthBoundary actions={actions} state={state}>
      {(household, logout) => (
        <RecipeImportPage
          {...(intentId === undefined ? {} : { initialIntentId: intentId })}
          householdId={household.id}
          householdName={household.name}
          key={recipeImportPageSessionKey(household.id, intentId)}
          onSignOut={logout}
          operations={operations}
        />
      )}
    </AuthBoundary>
  );
};

export const Route = createFileRoute("/")({
  component: MealPlannerRoute,
  validateSearch: decodeRecipeImportSearch,
});
