import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

import { AuthBoundary } from "../features/auth/auth-boundary.js";
import type {
  AuthBoundaryActions,
  HouseholdSummary,
} from "../features/auth/auth-boundary.js";
import {
  useAuthClient,
  requireAuthSuccess,
} from "../features/auth/auth-client.js";
import { deriveAuthBoundaryState } from "../features/auth/auth-state.js";
import { parseDisplayedIdentity } from "../features/auth/displayed-identity.js";
import type { DisplayedIdentity } from "../features/auth/displayed-identity.js";
import { IdentityQueryBoundary } from "../features/auth/identity-query-boundary.js";
import { makeBrowserHouseholdPeopleOperations } from "../features/household-people/browser-operations.js";
import { HouseholdPeoplePanel } from "../features/household-people/household-people-panel.js";
import { makeBrowserHouseholdProfileOperations } from "../features/household-profiles/browser-operations.js";
import { HouseholdProfilesPanel } from "../features/household-profiles/household-profiles-panel.js";
import { makeBrowserHouseholdOperations } from "../features/households/browser-operations.js";
import { HouseholdDomainStatus } from "../features/households/household-domain-status.js";
import { PrivateInterviewsPanel } from "../features/private-interviews/private-interviews-panel.js";
import { makeBrowserRecipeImportOperations } from "../features/recipe-import/browser-operations.js";
import { decodeRecipeImportSearch } from "../features/recipe-import/navigation.js";
import { RecipeImportPage } from "../features/recipe-import/recipe-import-page.js";

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
  const clients = useMemo(() => {
    const identity = { organizationId, userId };
    return {
      household: makeBrowserHouseholdOperations(identity),
      people: makeBrowserHouseholdPeopleOperations(identity),
      profiles: makeBrowserHouseholdProfileOperations(identity),
      recipes: makeBrowserRecipeImportOperations(identity),
    };
  }, [userId, organizationId]);
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
              void queryClient.invalidateQueries({
                queryKey: ["household-profile", household.id],
              });
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
  const session = authClient.useSession();
  const organizations = authClient.useListOrganizations();
  const activeOrganization = authClient.useActiveOrganization();

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
        if (session.data === null) {
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
