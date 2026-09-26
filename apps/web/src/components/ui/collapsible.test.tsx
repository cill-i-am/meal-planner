// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Collapsible, CollapsibleContent } from "./collapsible.js";
import { MotionProvider } from "./motion-provider.js";

afterEach(cleanup);

const content = (open: boolean) => (
  <Collapsible open={open}>
    <CollapsibleContent>
      <input aria-label="Invitation email" />
    </CollapsibleContent>
  </Collapsible>
);

it("keeps closed content mounted without exposing its fields to keyboard navigation", async () => {
  const { container, rerender } = render(content(true), {
    wrapper: MotionProvider,
  });

  expect(
    screen.getByRole("textbox", { name: "Invitation email" })
  ).toBeVisible();
  rerender(content(false));

  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "Invitation email" })
    ).toBeNull()
  );
  expect(
    container.querySelector('[data-slot="collapsible-content"]')
  ).toBeInTheDocument();
});
