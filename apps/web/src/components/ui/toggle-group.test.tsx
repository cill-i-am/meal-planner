// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import { ToggleGroup, ToggleGroupItem } from "./toggle-group.js";

afterEach(cleanup);

const controlledSegment = (value: string) => (
  <ToggleGroup variant="segment" value={[value]} aria-label="Person type">
    <ToggleGroupItem value="adult">Adult</ToggleGroupItem>
    <ToggleGroupItem value="child">Child</ToggleGroupItem>
  </ToggleGroup>
);

it("keeps one segment indicator as the selected choice changes", async () => {
  const user = userEvent.setup();
  render(
    <ToggleGroup
      variant="segment"
      defaultValue={["adult"]}
      aria-label="Person type"
    >
      <ToggleGroupItem value="adult">Adult</ToggleGroupItem>
      <ToggleGroupItem value="child">Child</ToggleGroupItem>
    </ToggleGroup>
  );

  const group = screen.getByRole("group", { name: "Person type" });
  const indicator = group.querySelector('[data-slot="toggle-group-indicator"]');
  expect(indicator).not.toBeNull();
  expect(indicator).toHaveStyle("--segment-index: 0");
  expect(screen.getByRole("button", { name: "Adult" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await user.click(screen.getByRole("button", { name: "Child" }));
  expect(group.querySelector('[data-slot="toggle-group-indicator"]')).toBe(
    indicator
  );
  expect(indicator).toHaveStyle("--segment-index: 1");
  expect(screen.getByRole("button", { name: "Child" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

it("places a controlled selection immediately and moves it when the value changes", () => {
  const { rerender } = render(controlledSegment("child"));
  const group = screen.getByRole("group", { name: "Person type" });
  const indicator = group.querySelector('[data-slot="toggle-group-indicator"]');
  expect(indicator).toHaveStyle("--segment-index: 1");

  rerender(controlledSegment("adult"));
  expect(group.querySelector('[data-slot="toggle-group-indicator"]')).toBe(
    indicator
  );
  expect(indicator).toHaveStyle("--segment-index: 0");
});

it("does not change a disabled segment selection", async () => {
  const user = userEvent.setup();
  render(
    <ToggleGroup
      variant="segment"
      defaultValue={["adult"]}
      aria-label="Person type"
      disabled
    >
      <ToggleGroupItem value="adult">Adult</ToggleGroupItem>
      <ToggleGroupItem value="child">Child</ToggleGroupItem>
    </ToggleGroup>
  );

  await user.click(screen.getByRole("button", { name: "Child" }));
  expect(screen.getByRole("button", { name: "Child" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Adult" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

it("retains the usual ToggleGroup behavior outside the segment variant", async () => {
  const user = userEvent.setup();
  render(
    <ToggleGroup defaultValue={["adult"]} aria-label="Person type">
      <ToggleGroupItem value="adult">Adult</ToggleGroupItem>
      <ToggleGroupItem value="child">Child</ToggleGroupItem>
    </ToggleGroup>
  );

  const group = screen.getByRole("group", { name: "Person type" });
  expect(
    group.querySelector('[data-slot="toggle-group-indicator"]')
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Child" }));
  expect(screen.getByRole("button", { name: "Child" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
