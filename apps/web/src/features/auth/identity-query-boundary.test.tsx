// @vitest-environment jsdom
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, expect, it } from "vitest";

import { parseDisplayedIdentity } from "./displayed-identity.js";
import { IdentityQueryBoundary } from "./identity-query-boundary.js";

afterEach(cleanup);

it("disposes queries, drafts and private connections when the displayed actor or family changes", async () => {
  const clients: QueryClient[] = [];
  let connections = 0;
  const PrivateView = () => {
    const client = useQueryClient();
    const [draft, setDraft] = useState("");
    useEffect(() => {
      clients.push(client);
      connections += 1;
      return () => {
        connections -= 1;
      };
    }, [client]);
    return (
      <input
        aria-label="Private draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  };
  const mounted = render(
    <IdentityQueryBoundary
      scope={parseDisplayedIdentity({
        organizationId: "family-a",
        userId: "alice",
      })}
    >
      <PrivateView />
    </IdentityQueryBoundary>
  );
  await userEvent.type(
    screen.getByLabelText("Private draft"),
    "private preference"
  );
  clients[0]?.setQueryData(["private-profile"], "alice's data");
  mounted.rerender(
    <IdentityQueryBoundary
      scope={parseDisplayedIdentity({
        organizationId: "family-a",
        userId: "alice",
      })}
    >
      <PrivateView />
    </IdentityQueryBoundary>
  );
  expect(screen.getByLabelText("Private draft")).toHaveValue(
    "private preference"
  );
  expect(clients).toHaveLength(1);
  mounted.rerender(
    <IdentityQueryBoundary
      scope={parseDisplayedIdentity({
        organizationId: "family-a",
        userId: "bob",
      })}
    >
      <PrivateView />
    </IdentityQueryBoundary>
  );
  expect(screen.getByLabelText("Private draft")).toHaveValue("");
  expect(clients[0]?.getQueryCache().getAll()).toEqual([]);
  expect(clients[1]?.getQueryData(["private-profile"])).toBeUndefined();
  expect(connections).toBe(1);
  clients[1]?.setQueryData(["private-profile"], "bob's data");
  mounted.rerender(
    <IdentityQueryBoundary
      scope={parseDisplayedIdentity({
        organizationId: "family-b",
        userId: "bob",
      })}
    >
      <PrivateView />
    </IdentityQueryBoundary>
  );
  expect(clients[1]?.getQueryCache().getAll()).toEqual([]);
  expect(clients[2]?.getQueryData(["private-profile"])).toBeUndefined();
  mounted.unmount();
  expect(connections).toBe(0);
});
