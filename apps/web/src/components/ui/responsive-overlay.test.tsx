// @vitest-environment jsdom
import {
  act,
  cleanup,
  render as baseRender,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";

import { MotionProvider } from "./motion-provider.js";
import { Overlay } from "./responsive-overlay.js";

const render = (ui: React.ReactElement) =>
  baseRender(ui, { wrapper: MotionProvider });

const mediaListeners = new Set<() => void>();
let mobile = false;

const setMobile = (next: boolean) => {
  mobile = next;
  for (const listener of mediaListeners) {
    listener();
  }
};

vi.stubGlobal("matchMedia", (query: string) => ({
  addEventListener: (_event: string, listener: () => void) =>
    mediaListeners.add(listener),
  matches: query === "(max-width: 767px)" && mobile,
  media: query,
  removeEventListener: (_event: string, listener: () => void) =>
    mediaListeners.delete(listener),
}));

afterEach(() => {
  cleanup();
  setMobile(false);
});

const Example = ({
  desktop = "dialog",
  initialOpen = false,
}: {
  desktop?: "dialog" | "drawer";
  initialOpen?: boolean;
}) => {
  const [open, setOpen] = React.useState(initialOpen);
  const [draft, setDraft] = React.useState("");
  return (
    <Overlay.Root
      open={open}
      onOpenChange={setOpen}
      desktop={desktop}
      drawerProps={{ snapPoints: [0.5, 1] }}
    >
      <Overlay.Trigger>Open people</Overlay.Trigger>
      <Overlay.Content>
        <Overlay.Header>
          <Overlay.Title>People</Overlay.Title>
          <Overlay.Description>Manage family members.</Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          <input
            aria-label="Person draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Overlay.Body>
        <Overlay.Footer>
          <Overlay.Close>Done</Overlay.Close>
        </Overlay.Footer>
      </Overlay.Content>
    </Overlay.Root>
  );
};

it("keeps a dialog mounted open on first render and lets Escape dismiss it", async () => {
  const user = userEvent.setup();
  render(<Example initialOpen />);

  expect(screen.getByRole("dialog", { name: "People" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "People" })).toBeNull();
});

it("opens an accessible desktop dialog and closes through its action", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Open people" }));
  expect(screen.getByRole("dialog", { name: "People" })).toHaveAttribute(
    "aria-describedby"
  );
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(
    screen.queryByRole("dialog", { name: "People" })
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open people" }));
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(
    screen.queryByRole("dialog", { name: "People" })
  ).not.toBeInTheDocument();
});

it("keeps an uncontrolled overlay open when its close event is canceled", async () => {
  const user = userEvent.setup();
  render(
    <Overlay.Root
      onOpenChange={(next, details) => {
        if (!next) {
          details.cancel();
        }
      }}
    >
      <Overlay.Trigger>Open editor</Overlay.Trigger>
      <Overlay.Content>
        <Overlay.Header>
          <Overlay.Title>Editor</Overlay.Title>
          <Overlay.Description>Unsaved changes</Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>Draft content</Overlay.Body>
      </Overlay.Content>
    </Overlay.Root>
  );

  await user.click(screen.getByRole("button", { name: "Open editor" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("dialog", { name: "Editor" })).toBeInTheDocument();
});

it("uses the native drawer on mobile and preserves owner state across a breakpoint change", async () => {
  setMobile(true);
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Open people" }));
  await user.type(
    screen.getByRole("textbox", { name: "Person draft" }),
    "Alex"
  );
  expect(
    document.querySelector('[data-slot="drawer-popup"]')
  ).toBeInTheDocument();
  expect(document.querySelector('[data-slot="drawer-popup"]')).toHaveAttribute(
    "data-snap-points"
  );
  expect(screen.getByRole("dialog", { name: "People" })).toBeInTheDocument();

  act(() => setMobile(false));
  expect(
    document.querySelector('[data-slot="dialog-content"]')
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Person draft" })).toHaveValue(
    "Alex"
  );
  expect(screen.getByRole("dialog", { name: "People" })).toBeInTheDocument();
});

it("uses a right drawer for the desktop drawer option", async () => {
  const user = userEvent.setup();
  render(<Example desktop="drawer" />);
  await user.click(screen.getByRole("button", { name: "Open people" }));
  expect(document.querySelector('[data-slot="drawer-popup"]')).toHaveAttribute(
    "data-swipe-direction",
    "right"
  );
});

it("keeps a parent drawer mounted while a nested confirmation opens and restores its trigger", async () => {
  setMobile(true);
  const user = userEvent.setup();
  render(
    <Overlay.Root>
      <Overlay.Trigger>Open parent</Overlay.Trigger>
      <Overlay.Content>
        <Overlay.Header>
          <Overlay.Title>Parent</Overlay.Title>
          <Overlay.Description>Parent drawer</Overlay.Description>
        </Overlay.Header>
        <Overlay.Body>
          <Overlay.Root>
            <Overlay.Trigger>Confirm action</Overlay.Trigger>
            <Overlay.Content>
              <Overlay.Header>
                <Overlay.Title>Confirmation</Overlay.Title>
                <Overlay.Description>Confirm action</Overlay.Description>
              </Overlay.Header>
              <Overlay.Body>Are you sure?</Overlay.Body>
              <Overlay.Footer>
                <Overlay.Close>Back</Overlay.Close>
              </Overlay.Footer>
            </Overlay.Content>
          </Overlay.Root>
        </Overlay.Body>
      </Overlay.Content>
    </Overlay.Root>
  );

  await user.click(screen.getByRole("button", { name: "Open parent" }));
  const trigger = screen.getByRole("button", { name: "Confirm action" });
  await user.click(trigger);
  expect(document.querySelectorAll('[data-slot="drawer-popup"]')).toHaveLength(
    2
  );
  await user.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "Parent" })).toBeInTheDocument()
  );
  await waitFor(() => expect(trigger).toHaveFocus());
});
