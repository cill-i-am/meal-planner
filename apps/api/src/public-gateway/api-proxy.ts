export interface MealPlannerApiService {
  readonly fetch: (request: Request) => Promise<Response> | Response;
}

export const isApiRequest = (request: Request) => {
  const { pathname } = new URL(request.url);
  {
    const checkedResult: boolean =
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/v1/") ||
      pathname === "/mcp" ||
      pathname.startsWith("/.well-known/oauth-");
    return checkedResult;
  }
};
