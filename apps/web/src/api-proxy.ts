export interface MealPlannerApiService {
  readonly fetch: (request: Request) => Promise<Response> | Response;
}

export const isApiRequest = (request: Request): boolean => {
  const { pathname } = new URL(request.url);
  return pathname.startsWith("/api/auth/") || pathname.startsWith("/v1/");
};

/** Preserve the original request and response so Cookie and Set-Cookie survive unchanged. */
export const proxyApiRequest = (
  request: Request,
  api: MealPlannerApiService
): Promise<Response> | Response => api.fetch(request);
