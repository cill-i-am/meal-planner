import { EmailAddress, UserId } from "@meal-planner/household-api";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

import type { makeAuthClient } from "./auth-client.js";
import { AuthRequestError } from "./auth-errors.js";

const AccountSession = Schema.Struct({
  session: Schema.Struct({
    activeOrganizationId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  user: Schema.Struct({ email: EmailAddress, id: UserId, name: Schema.String }),
});
export type Account = typeof AccountSession.Type;
export const accountKey = ["account"] as const;

/** Only the public account projection is cached/dehydrated, never the session token. */
export const accountQuery = (auth: ReturnType<typeof makeAuthClient>) =>
  queryOptions({
    queryFn: async ({ client, signal }) => {
      const response = await auth.getSession({ fetchOptions: { signal } });
      if (response.error) {
        throw new AuthRequestError(response.error);
      }
      const account =
        response.data === null
          ? null
          : Schema.decodeUnknownSync(AccountSession)(response.data);
      const previous = client.getQueryData<Account | null>(accountKey);
      if (previous && previous.user.id !== account?.user.id) {
        await client.cancelQueries({
          predicate: (query) => query.queryKey[0] !== accountKey[0],
        });
        client.removeQueries({
          predicate: (query) => query.queryKey[0] !== accountKey[0],
        });
        client.getMutationCache().clear();
      }
      return account;
    },
    queryKey: accountKey,
    refetchOnWindowFocus: "always",
    retry: false,
    staleTime: 30_000,
  });
