import { createFileRoute, useSearch } from "@tanstack/react-router";

import { decodeAuthSearch, SignupPage } from "../features/auth/index.js";

const SignupRoute = () => (
  <SignupPage redirect={useSearch({ from: "/signup" }).redirect} />
);
export const Route = createFileRoute("/signup")({
  component: SignupRoute,
  head: () => ({ meta: [{ title: "Create account · Meal Planner" }] }),
  validateSearch: decodeAuthSearch,
});
