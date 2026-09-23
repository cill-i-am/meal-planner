// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { PendingButton } from "./pending-button.js";

afterEach(cleanup);

it("keeps the action labelled and prevents a second submission while pending", () => {
  const view = render(
    <PendingButton type="submit" pending={false} pendingLabel="Saving family…">
      Save family
    </PendingButton>
  );
  expect(screen.getByRole("button", { name: "Save family" })).toBeEnabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  view.rerender(
    <PendingButton type="submit" pending pendingLabel="Saving family…">
      Save family
    </PendingButton>
  );
  expect(screen.getByRole("button", { name: "Saving family…" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Saving family…");
  expect(screen.getByRole("status").querySelector("svg")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
});
