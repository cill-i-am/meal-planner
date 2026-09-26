// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import { isInteractionSoundEnabled } from "../hooks/interaction-sound-preference.js";
import { InteractionSoundToggle } from "./interaction-sound-toggle.js";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

it("shares and persists the mute preference across mounted controls and remounts", async () => {
  const user = userEvent.setup();
  render(
    <>
      <InteractionSoundToggle />
      <InteractionSoundToggle />
    </>
  );
  const [first] = screen.getAllByRole("button", {
    name: "Mute interaction sounds",
  });
  if (!first) {
    throw new Error("Missing sound control");
  }
  await user.click(first);
  expect(
    screen.getAllByRole("button", { name: "Enable interaction sounds" })
  ).toHaveLength(2);
  expect(isInteractionSoundEnabled()).toBe(false);
  cleanup();
  render(<InteractionSoundToggle />);
  await user.click(
    screen.getByRole("button", { name: "Enable interaction sounds" })
  );
  expect(isInteractionSoundEnabled()).toBe(true);
  expect(
    screen.getByRole("button", { name: "Mute interaction sounds" })
  ).toBeVisible();
});

it("reflects a saved mute preference and changes from another tab", () => {
  window.localStorage.setItem("meal-planner:interaction-sound", "off");
  render(<InteractionSoundToggle />);
  expect(
    screen.getByRole("button", { name: "Enable interaction sounds" })
  ).toBeVisible();
  window.localStorage.setItem("meal-planner:interaction-sound", "on");
  fireEvent(
    window,
    new StorageEvent("storage", {
      key: "meal-planner:interaction-sound",
      newValue: "on",
    })
  );
  expect(
    screen.getByRole("button", { name: "Mute interaction sounds" })
  ).toBeVisible();
});
