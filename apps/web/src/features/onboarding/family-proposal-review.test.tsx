import type { ReviewedRoster } from "@meal-planner/agent-conversations-api";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { MotionProvider } from "../../components/ui/motion-provider.js";
import { FamilyRosterEditor } from "./family-proposal-review.js";

afterEach(cleanup);

it("submits edited names and explicit adult/child roles as one reviewed roster", async () => {
  const user = userEvent.setup();
  const accept = vi.fn(async (_reviewed: ReviewedRoster) => {});
  render(
    <MotionProvider>
      <FamilyRosterEditor
        initial={{
          creatorName: "Alex",
          familyName: "Murphy family",
          people: [
            {
              displayName: "Sam",
              draftId: "642ce142-0c32-4887-b3c3-ad8f2917a016",
              kind: "adult",
            },
          ],
        }}
        onAccept={accept}
        busy={false}
      />
    </MotionProvider>
  );
  await user.clear(screen.getByLabelText("Family name"));
  await user.type(screen.getByLabelText("Family name"), "Our family");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Name", { exact: true }));
  await user.type(screen.getByLabelText("Name", { exact: true }), "Samantha");
  await user.click(screen.getByRole("button", { name: "Child" }));
  await user.click(screen.getByRole("button", { name: "Create our family" }));
  expect(accept).toHaveBeenCalledOnce();
  expect(accept.mock.calls[0]?.[0]).toMatchObject({
    creatorName: "Alex",
    familyName: "Our family",
    people: [{ displayName: "Samantha", kind: "dependant" }],
  });
});

it("adds and removes people in the form array before the reviewed save", async () => {
  const user = userEvent.setup();
  const accept = vi.fn(async (_reviewed: ReviewedRoster) => {});
  render(
    <MotionProvider>
      <FamilyRosterEditor
        initial={{ creatorName: "Alex", familyName: "Our family", people: [] }}
        onAccept={accept}
        busy={false}
      />
    </MotionProvider>
  );

  await user.click(screen.getByRole("button", { name: "Add someone" }));
  expect(accept).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Create our family" }));
  expect(accept).not.toHaveBeenCalled();
  expect(
    screen.getByText(/Check the family name and each person’s name/u)
  ).toBeInTheDocument();
  await user.type(screen.getByLabelText("Name", { exact: true }), "Sam");
  await user.click(screen.getByRole("button", { name: "Child" }));
  await user.click(screen.getByRole("button", { name: "Create our family" }));
  expect(accept.mock.calls[0]?.[0].people).toMatchObject([
    { displayName: "Sam", kind: "dependant" },
  ]);
  expect(accept.mock.calls[0]?.[0].people[0]?.draftId).toMatch(
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/u
  );

  await user.click(screen.getByRole("button", { name: "Remove person" }));
  await user.click(screen.getByRole("button", { name: "Create our family" }));
  expect(accept.mock.calls[1]?.[0].people).toEqual([]);
});

it("keeps the reviewed draft locked after an unknown outcome and retries the saved action", async () => {
  const user = userEvent.setup();
  const accept = vi.fn(async (_reviewed: ReviewedRoster) => {});
  const retry = vi.fn(async () => {});
  render(
    <MotionProvider>
      <FamilyRosterEditor
        initial={{
          creatorName: "Alex",
          familyName: "Murphy family",
          people: [],
        }}
        onAccept={accept}
        onRetry={retry}
        status="unknown"
        busy={false}
      />
    </MotionProvider>
  );
  expect(screen.getByLabelText("Family name")).toBeDisabled();
  expect(
    screen.getByText(/couldn’t confirm whether your family was saved/u)
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Check and continue" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(accept).not.toHaveBeenCalled();
});

it("does not dispatch a roster with an empty family name", async () => {
  const user = userEvent.setup();
  const accept = vi.fn(async (_reviewed: ReviewedRoster) => {});
  render(
    <MotionProvider>
      <FamilyRosterEditor
        initial={{ creatorName: "Alex", familyName: "", people: [] }}
        onAccept={accept}
        busy={false}
      />
    </MotionProvider>
  );
  await user.click(screen.getByRole("button", { name: "Create our family" }));
  expect(accept).not.toHaveBeenCalled();
  expect(screen.getByText(/Check the family name/u)).toBeInTheDocument();
});
