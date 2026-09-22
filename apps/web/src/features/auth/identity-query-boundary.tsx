import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { DisplayedIdentity } from "./displayed-identity.js";

const IdentityQueries = ({ children }: { readonly children: ReactNode }) => {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: false, staleTime: 0 },
        },
      })
  );
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

/** A session change disposes old queries and remounts all forms and private connections. */
export const IdentityQueryBoundary = ({
  scope,
  children,
}: {
  readonly scope: DisplayedIdentity;
  readonly children: ReactNode;
}) => (
  <IdentityQueries key={JSON.stringify([scope.userId, scope.organizationId])}>
    {children}
  </IdentityQueries>
);
