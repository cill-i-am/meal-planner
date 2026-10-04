import { useMemo } from "react";

import { useApiRuntime } from "../api-client/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import {
  HouseholdPeoplePanel,
  makeHouseholdPeopleEffectOperations,
} from "../household-people/index.js";
import {
  HouseholdProfilesPanel,
  makeHouseholdProfileEffectOperations,
} from "../household-profiles/index.js";

export const FamilyDetails = ({
  scope,
  currentMemberId,
}: {
  readonly scope: DisplayedIdentity;
  readonly currentMemberId?: string;
}) => {
  const { organizationId, userId } = scope;
  const runtime = useApiRuntime();
  const operations = useMemo(
    () => ({
      people: makeHouseholdPeopleEffectOperations(scope, runtime),
      profiles: makeHouseholdProfileEffectOperations(scope, runtime),
    }),
    [organizationId, userId, runtime]
  );
  return (
    <div className="flex flex-col gap-8 py-6">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-5xl tracking-tight">
          Everyone at your table.
        </h1>
        <p className="text-muted-foreground max-w-xl">
          Manage your people, invitations and the food preferences your family
          has confirmed.
        </p>
      </header>
      <HouseholdPeoplePanel
        accountId={userId}
        organizationId={organizationId}
        operations={operations.people}
        {...(currentMemberId === undefined ? {} : { currentMemberId })}
      />
      <HouseholdProfilesPanel
        accountId={userId}
        organizationId={organizationId}
        operations={operations.profiles}
        peopleOperations={operations.people}
      />
    </div>
  );
};
