import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

import { StatusScreen } from "../components/status-screen.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { OurTastesPage } from "../features/agent-conversations/index.js";
import { useApiRuntime } from "../features/api-client/index.js";
import {
  AuthBoundary,
  accountQuery,
  organizationsQuery,
  activeOrganizationQuery,
  useAuthClient,
  requireAuthSuccess,
  deriveAuthBoundaryState,
  parseDisplayedIdentity,
  IdentityQueryBoundary,
} from "../features/auth/index.js";
import type {
  AuthBoundaryActions,
  HouseholdSummary,
  DisplayedIdentity,
} from "../features/auth/index.js";
import { familyQuery } from "../features/family/index.js";
import { FoodBookPage } from "../features/food-book/index.js";
import { MealPlanningPage } from "../features/meal-planning/index.js";
import {
  WorkspaceShell,
  FamilyDetails,
  decodeWorkspaceSearch,
  workspaceArea,
} from "../features/meal-workspace/index.js";
import type { WorkspaceSearch } from "../features/meal-workspace/index.js";
import {
  RecipeImportWorkspace,
  makeRecipeImportEffectOperations,
} from "../features/recipe-import/index.js";

const WorkspaceContent = ({
  scope,
  search,
  currentMemberId,
}: {
  readonly scope: DisplayedIdentity;
  readonly search: WorkspaceSearch;
  readonly currentMemberId?: string;
}) => {
  const { organizationId, userId } = scope;
  const runtime = useApiRuntime();
  const recipes = useMemo(
    () => makeRecipeImportEffectOperations(scope, runtime),
    [organizationId, userId, runtime]
  );
  if (search.import === true || search.intentId !== undefined) {
    return (
      <RecipeImportWorkspace
        householdId={organizationId}
        operations={recipes}
        {...(search.intentId === undefined
          ? {}
          : { initialIntentId: search.intentId })}
      />
    );
  }
  const area = workspaceArea(search);
  switch (area) {
    case "tastes": {
      return <OurTastesPage scope={scope} />;
    }
    case "weeks": {
      return <MealPlanningPage scope={scope} />;
    }
    case "food": {
      return (
        <FoodBookPage
          scope={scope}
          {...(search.recipeId === undefined
            ? {}
            : { initialRecipeId: search.recipeId })}
        />
      );
    }
    case "family": {
      return (
        <FamilyDetails
          scope={scope}
          {...(currentMemberId === undefined ? {} : { currentMemberId })}
        />
      );
    }
    default: {
      const unreachable: never = area;
      return unreachable;
    }
  }
};

const AuthenticatedMealPlanner = ({
  household,
  households,
  scope,
  search,
  currentMemberId,
  accountPending,
  accountError,
  onSelectFamily,
  onSignOut,
}: {
  readonly household: HouseholdSummary;
  readonly households: readonly HouseholdSummary[];
  readonly scope: DisplayedIdentity;
  readonly search: WorkspaceSearch;
  readonly currentMemberId?: string;
  readonly accountPending: boolean;
  readonly accountError: boolean;
  readonly onSelectFamily: (id: string) => void;
  readonly onSignOut: () => void;
}) => {
  const runtime = useApiRuntime();
  const family = useQuery(
    familyQuery(runtime, scope.userId, scope.organizationId)
  );
  if (family.isPending) {
    return <StatusScreen title="Loading your family…" />;
  }
  if (family.isError) {
    return (
      <StatusScreen
        title="Your family couldn’t load"
        retry={() => family.refetch()}
      />
    );
  }
  if (family.data.setup.status !== "complete") {
    return <Navigate to="/setup" replace />;
  }
  return (
    <WorkspaceShell
      area={workspaceArea(search)}
      household={household}
      households={households}
      pending={accountPending}
      onSelectFamily={onSelectFamily}
      onSignOut={onSignOut}
    >
      {accountError ? (
        <Alert>
          <AlertTitle>Your account change couldn’t be confirmed</AlertTitle>
          <AlertDescription>
            Check your connection and try the account action again.
          </AlertDescription>
        </Alert>
      ) : null}
      <WorkspaceContent
        scope={scope}
        search={search}
        {...(currentMemberId === undefined ? {} : { currentMemberId })}
      />
    </WorkspaceShell>
  );
};

const MealPlannerRoute = () => {
  const search = useSearch({ from: "/" });
  const queryClient = useQueryClient();
  const authClient = useAuthClient();
  const session = useQuery(accountQuery(authClient));
  const organizations = useQuery(
    organizationsQuery(authClient, session.data?.user.id)
  );
  const activeOrganization = useQuery(
    activeOrganizationQuery(authClient, session.data)
  );

  const selectFamily = useMutation({
    mutationFn: async (organizationId: string) => {
      await requireAuthSuccess(
        authClient.organization.setActive({ organizationId })
      );
      await queryClient.invalidateQueries();
    },
    retry: false,
  });

  const signOut = async () => {
    await requireAuthSuccess(authClient.signOut());
    queryClient.clear();
  };
  const refreshAccount = async () => {
    await Promise.all([
      session.refetch(),
      organizations.refetch(),
      activeOrganization.refetch(),
    ]);
  };
  const logout = useMutation({ mutationFn: signOut, retry: false });
  const actions: AuthBoundaryActions = {
    retry: refreshAccount,
    signOut,
  };

  const state = deriveAuthBoundaryState({
    activeOrganization,
    organizations,
    session,
  });

  return (
    <AuthBoundary actions={actions} state={state}>
      {(household) => {
        if (!session.data) {
          return null;
        }
        const scope = parseDisplayedIdentity({
          organizationId: household.id,
          userId: session.data.user.id,
        });
        const currentMemberId = activeOrganization.data?.members.find(
          (member) => member.userId === scope.userId
        )?.id;
        return (
          <IdentityQueryBoundary scope={scope}>
            <AuthenticatedMealPlanner
              household={household}
              scope={scope}
              search={search}
              households={
                state.kind === "authenticated" ? state.households : []
              }
              accountPending={selectFamily.isPending || logout.isPending}
              accountError={selectFamily.isError || logout.isError}
              onSelectFamily={selectFamily.mutate}
              {...(currentMemberId === undefined ? {} : { currentMemberId })}
              onSignOut={() => logout.mutate()}
            />
          </IdentityQueryBoundary>
        );
      }}
    </AuthBoundary>
  );
};

export const Route = createFileRoute("/")({
  component: MealPlannerRoute,
  validateSearch: decodeWorkspaceSearch,
});
