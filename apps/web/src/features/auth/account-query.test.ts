import { dehydrate, QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";

import { accountQuery } from "./account-query.js";
import { makeAuthClient } from "./auth-client.js";

it("dehydrates only public account fields and discards another account's cached resources", async () => {
  let identity = "alice";
  const auth = makeAuthClient(
    async () =>
      Response.json({
        session: {
          activeOrganizationId: null,
          id: "private-session-id",
          token: "private-token",
        },
        user: {
          email: `${identity}@example.test`,
          id: identity,
          name: identity,
          privateField: "private-user-field",
        },
      }),
    undefined,
    "https://meal.test/api/auth"
  );
  const client = new QueryClient();
  try {
    await client.fetchQuery(accountQuery(auth));
    const serialized = JSON.stringify(dehydrate(client));
    expect(serialized).toContain("alice@example.test");
    expect(serialized).not.toContain("private-");
    client.setQueryData(["families", "alice"], ["private-family"]);
    identity = "bob";
    await client.fetchQuery({ ...accountQuery(auth), staleTime: 0 });
    expect(client.getQueryData(["families", "alice"])).toBeUndefined();
    expect(JSON.stringify(dehydrate(client))).toContain("bob@example.test");
  } finally {
    client.clear();
  }
});
