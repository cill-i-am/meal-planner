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
    "Read your name, email address and whether your email is verified.",
  "meal-planner:assistant":
    "Read assistant conversations. With permission to make changes, send messages and answer proposed actions on your behalf.",
  "meal-planner:private":
    "Read your own private interviews and setup conversations. With permission to make changes, update your interviews and explicitly share profile answers.",
  "meal-planner:read":
    "Read your households, people, recipes, food preferences and meal plans.",
  "meal-planner:write":
    "Create and change families, invite people by email, manage membership, change food profiles and meal plans, and import and publish reviewed recipes.",
  offline_access:
    "Keep this connection active between visits, until its access expires or is revoked.",
};
