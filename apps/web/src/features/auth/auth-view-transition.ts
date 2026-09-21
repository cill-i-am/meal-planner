import type { AnyRouter, NavigateOptions } from "@tanstack/react-router";

const authPaths = new Set(["/login", "/signup", "/forgot-password"]);

export const getAuthViewTransition = (): NonNullable<
  NavigateOptions<AnyRouter>["viewTransition"]
> => {
  // TanStack otherwise falls back to animating every navigation without types.
  if (
    import.meta.env.SSR ||
    !window.CSS?.supports("selector(:active-view-transition-type(auth))")
  ) {
    return false;
  }
  return {
    types: ({ fromLocation, toLocation, pathChanged }) =>
      pathChanged &&
      fromLocation !== undefined &&
      authPaths.has(fromLocation.pathname) &&
      authPaths.has(toLocation.pathname) &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? ["auth"]
        : false,
  };
};
