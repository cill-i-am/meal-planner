export interface AuthorizationRequest {
  readonly clientId: string;
  readonly oauthQuery: string;
  readonly scopes: readonly string[];
}

/** The provider validates the signature; this parser only reads display fields. */
export const parseAuthorizationRequest = (
  search: string
): AuthorizationRequest | null => {
  const params = new URLSearchParams(search);
  const clientId = params.get("client_id");
  const scope = params.get("scope");
  if (
    !clientId ||
    !scope ||
    !params.get("sig") ||
    ["client_id", "scope", "sig"].some(
      (name) => params.getAll(name).length !== 1
    )
  ) {
    return null;
  }
  return {
    clientId,
    oauthQuery: search,
    scopes: [...new Set(scope.split(" ").filter((value) => value.length > 0))],
  };
};

export const permissionDescriptions: Readonly<Record<string, string>> = {
  "meal-planner:account":
    "Create households and manage household invitations and membership on your behalf.",
  "meal-planner:assistant":
    "Use Meal Planner’s assistant on your behalf, including conversations and recipe imports.",
  "meal-planner:private":
    "Read and change your own private interviews, answers and conversations.",
  "meal-planner:read":
    "Read your households, people, recipes, food preferences and meal plans.",
  "meal-planner:write":
    "Add and change household people, recipes, food preferences and meal plans.",
  offline_access:
    "Keep this connection active between visits, until its access expires or is revoked.",
};
