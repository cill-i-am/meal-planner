import type { AuthBoundaryState, HouseholdSummary } from "./auth-boundary.js";

interface AuthQuery<T> {
  readonly data: T | null;
  readonly error: unknown | null;
  readonly isPending: boolean;
}

interface OrganizationView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

interface SessionView {
  readonly user: { readonly email: string; readonly name: string };
}

const toHousehold = (organization: OrganizationView): HouseholdSummary => ({
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
});

export const deriveAuthBoundaryState = (queries: {
  readonly activeOrganization: AuthQuery<OrganizationView>;
  readonly organizations: AuthQuery<readonly OrganizationView[]>;
  readonly session: AuthQuery<SessionView>;
}): AuthBoundaryState => {
  if (queries.session.error !== null) {
    return { kind: "error" };
  }
  if (queries.session.isPending) {
    return { kind: "loading" };
  }
  if (queries.session.data === null) {
    return { kind: "anonymous" };
  }
  if (
    queries.organizations.error !== null ||
    queries.activeOrganization.error !== null
  ) {
    return { kind: "error" };
  }
  if (queries.organizations.isPending || queries.activeOrganization.isPending) {
    return { kind: "loading" };
  }
  return {
    activeHousehold:
      queries.activeOrganization.data === null
        ? null
        : toHousehold(queries.activeOrganization.data),
    households: (queries.organizations.data ?? []).map(toHousehold),
    kind: "authenticated",
    user: queries.session.data.user,
  };
};
