import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router";

import {
  decodeAuthEntrySearch,
  LoginPage,
  readOAuthQuery,
} from "../features/auth/index.js";

const LoginRoute = () => (
  <LoginPage
    redirect={useSearch({ from: "/login" }).redirect ?? "/"}
    oauthQuery={readOAuthQuery(useRouter().history.location.search)}
  />
);
export const Route = createFileRoute("/login")({
  component: LoginRoute,
  head: () => ({
    meta: [
      { title: "Log in · Meal Planner" },
      { content: "no-referrer", name: "referrer" },
      { content: "noindex", name: "robots" },
    ],
  }),
  headers: () => ({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  }),
  validateSearch: decodeAuthEntrySearch,
});
