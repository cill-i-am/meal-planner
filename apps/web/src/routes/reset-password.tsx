import { createFileRoute, useSearch } from "@tanstack/react-router";

import { decodeRecoverySearch } from "../features/recovery/recovery-input.js";
import { ResetPasswordPage } from "../features/recovery/recovery-screens.js";

const Screen = () => (
  <ResetPasswordPage {...useSearch({ from: "/reset-password" })} />
);
export const Route = createFileRoute("/reset-password")({
  component: Screen,
  head: () => ({
    meta: [
      { title: "Choose a new password · Meal Planner" },
      { content: "no-referrer", name: "referrer" },
    ],
  }),
  validateSearch: decodeRecoverySearch,
});
