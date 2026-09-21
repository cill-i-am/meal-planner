import { createFileRoute, useSearch } from "@tanstack/react-router";

import { decodeAuthSearch } from "../features/auth/auth-navigation.js";
import { AccountPage } from "../features/auth/auth-screens.js";

const SignupRoute = () => (
  <AccountPage signup redirect={useSearch({ from: "/signup" }).redirect} />
);
export const Route = createFileRoute("/signup")({
  component: SignupRoute,
  head: () => ({ meta: [{ title: "Create account · Meal Planner" }] }),
  validateSearch: decodeAuthSearch,
});
