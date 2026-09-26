import { createFileRoute, useSearch } from "@tanstack/react-router";

import { decodeAuthSearch } from "../features/auth/auth-navigation.js";
import { RecoveryRequestPage } from "../features/recovery/recovery-screens.js";

const RecoveryRoute = () => (
  <RecoveryRequestPage
    redirect={useSearch({ from: "/forgot-password" }).redirect}
  />
);
export const Route = createFileRoute("/forgot-password")({
  component: RecoveryRoute,
  head: () => ({ meta: [{ title: "Password reset · Meal Planner" }] }),
  validateSearch: decodeAuthSearch,
});
