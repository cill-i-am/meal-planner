import { createFileRoute, useSearch } from "@tanstack/react-router";

import { decodeAuthSearch, LoginPage } from "../features/auth/index.js";

const LoginRoute = () => (
  <LoginPage redirect={useSearch({ from: "/login" }).redirect} />
);
export const Route = createFileRoute("/login")({
  component: LoginRoute,
  head: () => ({ meta: [{ title: "Log in · Meal Planner" }] }),
  validateSearch: decodeAuthSearch,
});
