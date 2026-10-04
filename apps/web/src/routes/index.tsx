import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

import { StatusScreen } from "../components/status-screen.js";
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
import {
  HouseholdPeoplePanel,
  makeHouseholdPeopleEffectOperations,
} from "../features/household-people/index.js";
import {
  HouseholdProfilesPanel,
  invalidateHouseholdProfiles,
  makeBrowserHouseholdProfileOperations,
} from "../features/household-profiles/index.js";
import { makeBrowserHouseholdOperations } from "../features/households/browser-operations.js";
import { HouseholdDomainStatus } from "../features/households/household-domain-status.js";
import { PrivateInterviewsPanel } from "../features/private-interviews/private-interviews-panel.js";
import {
  makeRecipeImportEffectOperations,
  decodeRecipeImportSearch,
  RecipeImportPage,
} from "../features/recipe-import/index.js";

const AuthenticatedMealPlanner = ({
  household,
  scope,
  intentId,
  currentMemberId,
  onSignOut,
}: {
  readonly household: HouseholdSummary;
  readonly scope: DisplayedIdentity;
  readonly intentId?: RecipeImportIntentId;
  readonly currentMemberId?: string;
  readonly onSignOut: () => Promise<void>;
}) => {
  const queryClient = useQueryClient();
  const { userId, organizationId } = scope;
  const runtime = useApiRuntime();
  const family = useQuery(familyQuery(runtime, userId, organizationId));
  const clients = useMemo(() => {
    const identity = { organizationId, userId };
    return {
      household: makeBrowserHouseholdOperations(identity),
      people: makeHouseholdPeopleEffectOperations(identity, runtime),
      profiles: makeBrowserHouseholdProfileOperations(identity),
      recipes: makeRecipeImportEffectOperations(identity, runtime),
    };
  }, [userId, organizationId, runtime]);
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
    <RecipeImportPage
      {...(intentId === undefined ? {} : { initialIntentId: intentId })}
      householdId={household.id}
      householdName={household.name}
      householdDomainStatus={
        <HouseholdDomainStatus
          operations={clients.household}
          organizationId={household.id}
        />
      }
      householdPeople={
        <>
          <PrivateInterviewsPanel
            accountId={userId}
            householdId={household.id}
            onConfirmationSettled={() => {
              void invalidateHouseholdProfiles(queryClient, household.id);
            }}
          />
          <HouseholdPeoplePanel
            {...(currentMemberId === undefined ? {} : { currentMemberId })}
            accountId={userId}
            operations={clients.people}
            organizationId={household.id}
          />
          <a
            className="inline-flex min-h-11 items-center underline"
            href="#household-profiles"
          >
            View and edit food profiles
          </a>
          <HouseholdProfilesPanel
            accountId={userId}
            operations={clients.profiles}
            organizationId={household.id}
            peopleOperations={clients.people}
          />
        </>
      }
      key={`${household.id}:${intentId ?? "new"}`}
      onSignOut={onSignOut}
      operations={clients.recipes}
    />
  );
};

const MealPlannerRoute = () => {
  const { intentId } = useSearch({ from: "/" });
  const queryClient = useQueryClient();
  const authClient = useAuthClient();
  const session = useQuery(accountQuery(authClient));
  const organizations = useQuery(
    organizationsQuery(authClient, session.data?.user.id)
  );
  const activeOrganization = useQuery(
    activeOrganizationQuery(authClient, session.data)
  );

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
      {(household, logout) => {
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
              {...(intentId === undefined ? {} : { intentId })}
              {...(currentMemberId === undefined ? {} : { currentMemberId })}
              onSignOut={logout}
            />
          </IdentityQueryBoundary>
        );
      }}
    </AuthBoundary>
  );
};

export const Route = createFileRoute("/")({
  component: MealPlannerRoute,
  validateSearch: decodeRecipeImportSearch,
});
