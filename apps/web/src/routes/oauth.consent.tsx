import { createFileRoute, redirect } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { accountQuery } from "../features/auth/index.js";
import {
  oauthClientQuery,
  OAuthConsentError,
  OAuthConsentPage,
  parseAuthorizationRequest,
} from "../features/oauth-consent/index.js";

// Router's parsed location serializes repeated query keys as JSON arrays.
// OAuth signatures cover the native request query, including repeated keys.
const authorizationSearch = createIsomorphicFn()
  .client(() => window.location.search)
  .server(() => new URL(getRequest().url).search);

const ConsentRoute = () => {
  // eslint-disable-next-line no-use-before-define -- TanStack invokes this component after Route initialization.
  const { authorizationRequest } = Route.useRouteContext();
  return <OAuthConsentPage request={authorizationRequest} />;
};

export const Route = createFileRoute("/oauth/consent")({
  beforeLoad: async ({ context }) => {
    const authorizationRequest = parseAuthorizationRequest(
      authorizationSearch()
    );
    if (authorizationRequest !== null) {
      const account = await context.queryClient.ensureQueryData(
        accountQuery(context.auth)
      );
      if (account === null) {
        throw redirect({
          search: {
            redirect: `/oauth/consent${authorizationRequest.oauthQuery}`,
          },
          to: "/login",
        });
      }
      await context.queryClient.ensureQueryData(
        oauthClientQuery(context.auth, authorizationRequest, account.user.id)
      );
    }
    return { authorizationRequest };
  },
  component: ConsentRoute,
  errorComponent: OAuthConsentError,
  head: () => ({
    meta: [
      { title: "Connect an app · Meal Planner" },
      { content: "no-referrer", name: "referrer" },
      { content: "noindex", name: "robots" },
    ],
  }),
  headers: () => ({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  }),
});
