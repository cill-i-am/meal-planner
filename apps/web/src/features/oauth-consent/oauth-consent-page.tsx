import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { Link, Navigate, useHydrated } from "@tanstack/react-router";
import { Schema } from "effect";
import type { ReactNode } from "react";

import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import {
  accountQuery,
  AuthRequestError,
  EntryFormSurface,
  EntryLayout,
  requireAuthSuccess,
  useAuthClient,
} from "../auth/index.js";
import type { Account, makeAuthClient } from "../auth/index.js";
import { permissionDescriptions } from "./authorization-request.js";
import type { AuthorizationRequest } from "./authorization-request.js";

const ClientIdentity = Schema.Struct({
  client_id: Schema.String,
  client_name: Schema.optional(Schema.String),
  client_uri: Schema.optional(Schema.String),
});
const ConsentRedirect = Schema.Struct({
  redirect: Schema.Literal(true),
  url: Schema.String,
});

export const oauthClientQuery = (
  auth: ReturnType<typeof makeAuthClient>,
  request: AuthorizationRequest,
  userId: string
) =>
  queryOptions({
    queryFn: async ({ signal }) => {
      // Native public-client GET supports SSR without fabricating a browser
      // Origin. The browser verifies the signature before enabling consent.
      const requestVerified = !import.meta.env.SSR;
      const fetchOptions = {
        headers: { "x-meal-planner-user": userId },
        signal,
      };
      const response = await requireAuthSuccess(
        requestVerified
          ? auth.oauth2.publicClientPrelogin({
              client_id: request.clientId,
              fetchOptions,
              oauth_query: request.oauthQuery,
            })
          : auth.oauth2.publicClient({
              fetchOptions,
              query: { client_id: request.clientId },
            })
      );
      const client = Schema.decodeUnknownSync(ClientIdentity)(response);
      if (client.client_id !== request.clientId) {
        throw new AuthRequestError(null);
      }
      return { ...client, requestVerified };
    },
    queryKey: ["oauth-client", userId, request.oauthQuery],
    retry: false,
    staleTime: 0,
  });

const ConsentMessage = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) => (
  <EntryLayout>
    <EntryFormSurface className="mx-auto space-y-6 pt-16 md:pt-24">
      <h1 tabIndex={-1} className="font-display text-4xl tracking-tight">
        {title}
      </h1>
      {children}
    </EntryFormSurface>
  </EntryLayout>
);

export const OAuthConsentError = () => (
  <ConsentMessage title="This connection request is unavailable">
    <p className="text-muted-foreground">
      Return to the app you’re connecting and start again. The request may have
      expired or changed.
    </p>
    <Button nativeButton={false} render={<Link to="/" />}>
      Back to Meal Planner
    </Button>
  </ConsentMessage>
);

const ConsentRequest = ({
  request,
  account,
}: {
  readonly request: AuthorizationRequest;
  readonly account: Account;
}) => {
  const auth = useAuthClient();
  const hydrated = useHydrated();
  const client = useQuery(oauthClientQuery(auth, request, account.user.id));
  const decision = useMutation({
    mutationFn: async (accept: boolean) => {
      const response = await requireAuthSuccess(
        auth.oauth2.consent({
          accept,
          fetchOptions: { headers: { "x-meal-planner-user": account.user.id } },
          oauth_query: request.oauthQuery,
        })
      );
      Schema.decodeUnknownSync(ConsentRedirect)(response);
    },
    retry: false,
  });
  if (client.isPending) {
    return (
      <ConsentMessage title="Review app access">
        <p role="status">Loading the connection request…</p>
      </ConsentMessage>
    );
  }
  if (client.isError) {
    return <OAuthConsentError />;
  }
  const knownPermissions = request.scopes.every(
    (scope) => permissionDescriptions[scope] !== undefined
  );
  const blocked =
    !hydrated ||
    decision.isPending ||
    decision.isSuccess ||
    decision.isError ||
    !client.data.requestVerified ||
    client.isFetching;
  return (
    <ConsentMessage title="Connect to Meal Planner">
      <div className="space-y-3">
        <p className="text-lg font-medium break-words">
          {client.data.client_name || request.clientId}
        </p>
        <p className="text-muted-foreground text-sm break-all">
          Client ID: {request.clientId}
        </p>
        {client.data.client_uri && (
          <p className="text-muted-foreground text-sm break-all">
            App website: {client.data.client_uri}
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          Identity not verified by Meal Planner. Connect only if you recognise
          the app and started this request.
        </p>
      </div>
      <p className="break-words">
        Signed in as <strong>{account.user.email}</strong>
      </p>
      <div className="space-y-3">
        <h2 className="font-medium">This app is requesting permission to:</h2>
        <ul className="list-disc space-y-3 pl-5 text-sm">
          {request.scopes.map((scope) => (
            <li key={scope}>
              {permissionDescriptions[scope] ??
                `Unrecognised permission: ${scope}`}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          Access applies to households you belong to and remains limited by your
          role in each household.
        </p>
      </div>
      {!knownPermissions && (
        <Alert variant="destructive">
          <AlertDescription>
            This request includes a permission Meal Planner cannot explain.
            Return to the app and start a new connection.
          </AlertDescription>
        </Alert>
      )}
      {decision.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            We couldn’t confirm your choice. Return to the app and check the
            connection before starting again.
          </AlertDescription>
        </Alert>
      )}
      {!client.data.requestVerified && (
        <p role="status" className="text-muted-foreground text-sm">
          Checking this connection request…
        </p>
      )}
      <div className="flex gap-3">
        <PendingButton
          className="flex-1"
          disabled={blocked}
          pending={decision.isPending && decision.variables === false}
          pendingLabel="Declining…"
          type="button"
          variant="outline"
          onClick={() => decision.mutate(false)}
        >
          Deny
        </PendingButton>
        <PendingButton
          className="flex-1"
          disabled={blocked || !knownPermissions}
          pending={decision.isPending && decision.variables === true}
          pendingLabel="Connecting…"
          type="button"
          onClick={() => decision.mutate(true)}
        >
          Allow access
        </PendingButton>
      </div>
      {decision.isSuccess && (
        <p role="status" className="text-muted-foreground text-sm">
          Returning to the app…
        </p>
      )}
    </ConsentMessage>
  );
};

export const OAuthConsentPage = ({
  request,
}: {
  readonly request: AuthorizationRequest | null;
}) => {
  const auth = useAuthClient();
  const session = useQuery(accountQuery(auth));
  if (request === null || session.isError) {
    return <OAuthConsentError />;
  }
  if (session.isPending) {
    return (
      <ConsentMessage title="Review app access">
        <p role="status">Loading your account…</p>
      </ConsentMessage>
    );
  }
  if (session.data === null) {
    return (
      <Navigate
        to="/login"
        search={{ redirect: `/oauth/consent${request.oauthQuery}` }}
        replace
      />
    );
  }
  return (
    <ConsentRequest
      key={`${session.data.user.id}:${request.oauthQuery}`}
      account={session.data}
      request={request}
    />
  );
};
