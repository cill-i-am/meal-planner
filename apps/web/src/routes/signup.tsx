import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router";

import {
  decodeAuthEntrySearch,
  SignupPage,
  readOAuthQuery,
} from "../features/auth/index.js";

const SignupRoute = () => (
  <SignupPage
    redirect={useSearch({ from: "/signup" }).redirect ?? "/"}
    oauthQuery={readOAuthQuery(useRouter().history.location.search)}
  />
);
export const Route = createFileRoute("/signup")({
  component: SignupRoute,
  head: () => ({
    meta: [
      { title: "Create account · Meal Planner" },
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
