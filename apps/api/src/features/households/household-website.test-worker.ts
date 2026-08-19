interface HouseholdWebsiteTestEnv {
  readonly MEAL_PLANNER_API: {
    readonly fetch: (request: Request) => Promise<Response>;
  };
}

/** Same-origin Website Worker proxy used by the real-runtime acceptance test. */
export default {
  fetch: (request: Request, env: HouseholdWebsiteTestEnv) =>
    env.MEAL_PLANNER_API.fetch(request),
};
