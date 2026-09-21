import { createFileRoute, useSearch } from "@tanstack/react-router";

import { decodeAuthSearch } from "../features/auth/auth-navigation.js";
import { RecoveryUnavailablePage } from "../features/auth/auth-screens.js";

const RecoveryRoute = () => (
  <RecoveryUnavailablePage
    redirect={useSearch({ from: "/forgot-password" }).redirect}
  />
);
export const Route = createFileRoute("/forgot-password")({
  component: RecoveryRoute,
  head: () => ({ meta: [{ title: "Password reset · Meal Planner" }] }),
  validateSearch: decodeAuthSearch,
});
