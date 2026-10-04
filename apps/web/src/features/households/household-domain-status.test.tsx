import { HouseholdStatus } from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HouseholdOperations } from "./browser-operations.js";
import { HouseholdDomainStatus } from "./household-domain-status.js";

afterEach(cleanup);

const readyHousehold = Schema.decodeUnknownSync(HouseholdStatus)({
  createdAtEpochMs: 1_777_777_777_777,
  organizationId: "organization-a",
  status: "ready",
});

const renderStatus = (
  operations: HouseholdOperations,
  organizationId = "organization-a"
) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <HouseholdDomainStatus
        operations={operations}
        organizationId={organizationId}
      />
    </QueryClientProvider>
  );

describe("HouseholdDomainStatus", () => {
  it("shows initialization progress", () => {
    renderStatus({
      current: vi.fn(() => Effect.never),
    });

    expect(
      screen.getByText("Preparing household storage…")
    ).toBeInTheDocument();
  });

  it("does not reuse another household's ready result", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const first = { current: vi.fn(() => Effect.succeed(readyHousehold)) };
    const second = {
      current: vi.fn(() => Effect.never),
    };
    const view = render(
      <QueryClientProvider client={client}>
        <HouseholdDomainStatus
          operations={first}
          organizationId="organization-a"
        />
      </QueryClientProvider>
    );
    expect(
      await screen.findByText("Household storage ready")
    ).toBeInTheDocument();
    view.rerender(
      <QueryClientProvider client={client}>
        <HouseholdDomainStatus
          operations={second}
          organizationId="organization-b"
        />
      </QueryClientProvider>
    );
    expect(
      screen.getByText("Preparing household storage…")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Household storage ready")
    ).not.toBeInTheDocument();
    expect(second.current).toHaveBeenCalledOnce();
  });

  it("shows a user-legible ready state", async () => {
    renderStatus({
      current: vi.fn(() => Effect.succeed(readyHousehold)),
    });

    expect(
      await screen.findByText("Household storage ready")
    ).toBeInTheDocument();
  });

  it("shows a retryable safe failure", async () => {
    const current = vi
      .fn<HouseholdOperations["current"]>()
      .mockReturnValueOnce(Effect.die(new Error("private failure")))
      .mockReturnValueOnce(Effect.succeed(readyHousehold));
    renderStatus({ current });

    expect(
      await screen.findByText("Household storage unavailable.")
    ).toBeInTheDocument();
    expect(screen.queryByText("private failure")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByText("Household storage ready")
    ).toBeInTheDocument();
    expect(current).toHaveBeenCalledTimes(2);
  });
});
