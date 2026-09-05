export interface MealPlannerApiService {
  readonly fetch: (request: Request) => Promise<Response> | Response;
}

export const isApiRequest = (request: Request): boolean => {
  const { pathname } = new URL(request.url);
  return pathname.startsWith("/api/auth/") || pathname.startsWith("/v1/");
};
