import { ConversationView } from "@meal-planner/agent-conversations-api";
import { HouseholdPersonId } from "@meal-planner/household-api";
import {
  cleanup,
  render as baseRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import type { ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { MotionProvider } from "../../components/ui/motion-provider.js";
import { conversationCatalog } from "./conversation-catalog.js";
import type { AgentConversationController } from "./conversation-controller.js";
import { ConversationSurface } from "./conversation-surface.js";

const familyId = "00000000-0000-4000-8000-000000000011";
const childId = "person_00000000-0000-4000-8000-000000000012";
const adultId = "person_00000000-0000-4000-8000-000000000013";
const questionId = "00000000-0000-4000-8000-000000000014";
const child = Schema.decodeUnknownSync(HouseholdPersonId)(childId);
const adult = Schema.decodeUnknownSync(HouseholdPersonId)(adultId);
const render = (ui: ReactElement) =>
  baseRender(ui, { wrapper: MotionProvider });

const view = Schema.decodeUnknownSync(ConversationView)({
  actions: [],
  blocks: [
    {
      _tag: "Question",
      foodTopic: "pasta",
      id: questionId,
      prompt: "Would Maya enjoy pasta?",
      revision: 1,
      status: "proposed",
      targetPersonId: childId,
      turnId: "00000000-0000-4000-8000-000000000016",
    },
  ],
  id: "00000000-0000-4000-8000-000000000015",
  messages: [],
  scope: { _tag: "FamilyShared", familyId },
  turns: [],
  version: 0,
});

const makeConversation = (
  submit: AgentConversationController["submit"]
): AgentConversationController => ({
  act: vi.fn(),
  actionState: null,
  busy: false,
  error: null,
  messages: [],
  pendingAction: null,
  recoveryBlocked: false,
  refresh: vi.fn(),
  retryAction: vi.fn(),
  status: "ready",
  submit,
  view,
});

afterEach(cleanup);

it("starts the first food question on an explicit click", async () => {
  const user = userEvent.setup();
  const submit = vi.fn(() => Promise.resolve());
  render(
    <ConversationSurface
      conversation={{
        ...makeConversation(submit),
        view: { ...view, blocks: [] },
      }}
      people={[
        {
          displayName: "Maya",
          id: child,
          isCurrentAdult: false,
          kind: "dependant",
        },
      ]}
      selectedPersonId={child}
    />
  );
  expect(screen.getByRole("textbox", { name: "Your message" })).toBeEnabled();
  expect(submit).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Ask our first food question" })
  );
  expect(submit).toHaveBeenCalledWith("Ask our first food question.", {
    focusPersonId: child,
    planId: null,
  });
});

it("keeps free text available beside the first-food starter", async () => {
  const user = userEvent.setup();
  const submit = vi.fn(() => Promise.resolve());
  render(
    <ConversationSurface
      conversation={{
        ...makeConversation(submit),
        view: { ...view, blocks: [] },
      }}
    />
  );
  expect(
    screen.getByRole("button", { name: "Ask our first food question" })
  ).toBeVisible();
  await user.type(
    screen.getByRole("textbox", { name: "Your message" }),
    "Add a meal option"
  );
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(submit).toHaveBeenCalledWith("Add a meal option", {
    focusPersonId: null,
    planId: null,
  });
});

it("answers a curated food question for the selected managed child", async () => {
  const user = userEvent.setup();
  const submit = vi.fn(() => Promise.resolve());
  render(
    <ConversationSurface
      conversation={makeConversation(submit)}
      people={[
        {
          displayName: "Maya",
          id: child,
          isCurrentAdult: false,
          kind: "dependant",
        },
      ]}
      selectedPersonId={child}
      onSelectPerson={vi.fn()}
    />
  );
  expect(
    screen.getByRole("img", { name: /pasta as an illustration/iu })
  ).toHaveAttribute("src", "/images/journey/pesto-pasta.avif");
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith("Maya would enjoy pasta.", {
      answerToBlockId: view.blocks[0]?.id,
      focusPersonId: child,
      foodAnswer: "yes",
      planId: null,
    })
  );
});

it("keeps an adult's own answers in their private space", () => {
  render(
    <ConversationSurface
      conversation={makeConversation(vi.fn())}
      people={[
        {
          displayName: "Alex",
          id: adult,
          isCurrentAdult: true,
          kind: "adult",
        },
      ]}
      selectedPersonId={adult}
      onSelectPerson={vi.fn()}
    />
  );
  expect(
    screen.getByText(/your own food conversation is private/iu)
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Your message" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Ask our first food question" })
  ).toBeDisabled();
});

it("requires a separate safety confirmation before accepting a proposed removal", async () => {
  const user = userEvent.setup();
  const act = vi.fn().mockResolvedValue({
    _tag: "Committed",
    actionId: "00000000-0000-4000-8000-000000000019",
    familyId,
  });
  const safetyView = Schema.decodeUnknownSync(ConversationView)({
    ...view,
    blocks: [
      {
        _tag: "PersonFactProposal",
        change: {
          _tag: "Remove",
          factId: "fact_00000000-0000-4000-8000-000000000017",
        },
        explanation: "Maya may no longer need this exclusion.",
        id: "00000000-0000-4000-8000-000000000018",
        personId: childId,
        profileVersion: 1,
        requiresSafetyConfirmation: true,
        reviewedBefore: {
          _tag: "HardConstraint",
          category: "allergen",
          handling: "exclude",
          label: "Peanuts",
        },
        revision: 1,
        status: "proposed",
        turnId: "00000000-0000-4000-8000-000000000016",
      },
    ],
  });
  render(
    <ConversationSurface
      conversation={{ ...makeConversation(vi.fn()), act, view: safetyView }}
      people={[
        {
          displayName: "Maya",
          id: child,
          isCurrentAdult: false,
          kind: "dependant",
        },
      ]}
      selectedPersonId={child}
    />
  );
  await user.click(screen.getByRole("button", { name: "Review food fact" }));
  const review = within(screen.getByRole("dialog"));
  await waitFor(() =>
    expect(review.getByText(/before: peanuts/iu)).toBeVisible()
  );
  expect(review.getByText(/after: remove this fact/iu)).toBeVisible();
  const confirm = review.getByRole("button", { name: "Confirm for family" });
  expect(confirm).toBeDisabled();
  await user.click(
    review.getByRole("checkbox", {
      name: "I confirm this safety constraint change",
    })
  );
  await user.click(confirm);
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith(
      safetyView.blocks[0],
      "accept",
      null,
      "I confirm this safety constraint change"
    )
  );
});

it("routes a meal setup proposal through explicit review before acting", async () => {
  const user = userEvent.setup();
  const setupView = Schema.decodeUnknownSync(ConversationView)({
    ...view,
    blocks: [
      {
        _tag: "PlanningContentProposal",
        command: {
          _tag: "SetCookingCapacity",
          value: {
            availableEquipment: ["oven"],
            maximumSubstantialCookEventsPerWeek: 3,
          },
        },
        expectedContentVersion: 0,
        explanation: "Plan around three cooking evenings.",
        id: "00000000-0000-4000-8000-000000000020",
        revision: 1,
        status: "proposed",
        turnId: "00000000-0000-4000-8000-000000000016",
      },
    ],
  });
  const act = vi.fn().mockResolvedValue({
    _tag: "Committed",
    actionId: "00000000-0000-4000-8000-000000000021",
    familyId,
  });
  const onReview = vi.fn();
  render(
    <ConversationSurface
      conversation={{ ...makeConversation(vi.fn()), act, view: setupView }}
      onPlanningContentProposalReview={onReview}
    />
  );
  await user.click(
    screen.getByRole("button", { name: "Review meal setup change" })
  );
  expect(onReview).toHaveBeenCalledOnce();
  expect(act).not.toHaveBeenCalled();
  const [block, actions] = onReview.mock.calls[0] as [
    (typeof setupView.blocks)[number],
    { confirm: () => Promise<void> },
  ];
  await actions.confirm();
  expect(act).toHaveBeenCalledWith(block, "accept");
});

it("rejects an arbitrary component outside the closed catalog", () => {
  expect(
    conversationCatalog.validate({
      elements: {
        rogue: {
          children: [],
          props: { html: "<script>alert(1)</script>" },
          type: "RawHtml",
        },
      },
      root: "rogue",
    }).success
  ).toBe(false);
});
