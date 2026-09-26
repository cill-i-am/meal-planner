import { createFileRoute, useSearch } from "@tanstack/react-router";

import { decodeAuthSearch } from "../features/auth/auth-navigation.js";
import { LoginPage } from "../features/auth/auth-screens.js";

const LoginRoute = () => (
  <LoginPage redirect={useSearch({ from: "/login" }).redirect} />
);
export const Route = createFileRoute("/login")({
  component: LoginRoute,
  head: () => ({ meta: [{ title: "Log in · Meal Planner" }] }),
  validateSearch: decodeAuthSearch,
});
