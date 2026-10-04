import type {
  ConversationActionId,
  ReviewedRoster,
} from "@meal-planner/agent-conversations-api";
import type { Family } from "@meal-planner/families";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { Activity, useEffect, useRef, useState } from "react";

import { OperationError } from "../../components/operation-error.js";
import { Button } from "../../components/ui/button.js";
import {
  AgentConversationProvider,
  FamilySetupChat,
  FamilySetupChatComposer,
  FamilySetupChatHistory,
  setupRosterValue,
  useAgentConversation,
} from "../agent-conversations/index.js";
import { useAccount } from "../auth/index.js";
import {
  useCompleteFamilySetup,
  useFamilyActions,
  useFamilyList,
} from "../family/index.js";
import { FamilyTable } from "./family-table.js";
import { ManualFamilySetup } from "./manual-family-setup.js";
import { SetupFrame } from "./setup-ui.js";

const setupScope = { _tag: "AccountPrivateSetup" } as const;

const tableStage = (
  familyId: HouseholdOrganizationId | null,
  saving: boolean,
  unknown: boolean
): "draft" | "saving" | "saved" | "unknown" => {
  if (familyId) {
    return "saved";
  }
  if (unknown) {
    return "unknown";
  }
  return saving ? "saving" : "draft";
};

const JoinedFamilies = ({
  families,
  busy,
  onSelect,
}: {
  readonly families: readonly Family[] | undefined;
  readonly busy: boolean;
  readonly onSelect: (id: HouseholdOrganizationId) => Promise<void>;
}) => {
  if (!families || families.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-sm">Continue with</span>
      {families.map((family) => (
        <Button
          key={family.id}
          variant="link"
          disabled={busy}
          onClick={() => {
            void onSelect(family.id);
          }}
        >
          {family.name}
        </Button>
      ))}
    </div>
  );
};

const FamilySetupConversationError = () => {
  const conversation = useAgentConversation();
  if (conversation.status === "unavailable") {
    return (
      <OperationError>
        Chat couldn’t load. You can add your family manually.
      </OperationError>
    );
  }
  if (conversation.actionState?._tag === "Rejected") {
    return (
      <OperationError>
        The draft changed before it could save. Check the table and tell me what
        to change.
      </OperationError>
    );
  }
  return null;
};

const FamilyConversationSetup = () => {
  const account = useAccount();
  const conversation = useAgentConversation();
  const families = useFamilyList();
  const actions = useFamilyActions();
  const finish = useCompleteFamilySetup();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"conversation" | "manual">("conversation");
  const [manualSession, setManualSession] = useState<{
    readonly initial: ReviewedRoster | null;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const [navigationError, setNavigationError] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const attemptedConfirmation = useRef<ConversationActionId | null>(null);
  const attemptedNavigation = useRef<HouseholdOrganizationId | null>(null);
  const roster = setupRosterValue(conversation);
  const busy = opening || loggingOut || conversation.busy;
  const committedFamily =
    conversation.actionState?._tag === "Committed"
      ? conversation.actionState.familyId
      : null;
  const confirmation = conversation.view?.turns.at(-1)?.setupConfirmation;

  const continueToFood = async (familyId: HouseholdOrganizationId) => {
    setOpening(true);
    setNavigationError(false);
    try {
      await finish.mutateAsync(familyId);
      await Effect.runPromise(actions.selectFamily(familyId));
      await navigate({ href: "/?area=tastes" });
    } catch {
      setNavigationError(true);
    } finally {
      setOpening(false);
    }
  };

  useEffect(() => {
    if (
      !confirmation ||
      conversation.status !== "ready" ||
      conversation.busy ||
      conversation.pendingAction !== null ||
      conversation.recoveryBlocked ||
      attemptedConfirmation.current === confirmation.actionId
    ) {
      return;
    }
    attemptedConfirmation.current = confirmation.actionId;
    void conversation.confirmSetup();
  }, [confirmation, conversation]);

  useEffect(() => {
    if (!committedFamily || attemptedNavigation.current === committedFamily) {
      return;
    }
    attemptedNavigation.current = committedFamily;
    void continueToFood(committedFamily);
  }, [committedFamily]);

  const openExistingFamily = async (familyId: HouseholdOrganizationId) => {
    setOpening(true);
    setNavigationError(false);
    try {
      await Effect.runPromise(actions.selectFamily(familyId));
      await navigate({ search: { familyId }, to: "/setup/review" });
    } catch {
      setNavigationError(true);
    } finally {
      setOpening(false);
    }
  };

  return (
    <FamilySetupChat
      conversation={{ ...conversation, busy }}
      name={account.user.name}
    >
      {manualSession !== null && (
        <Activity mode={mode === "manual" ? "visible" : "hidden"}>
          <ManualFamilySetup
            initial={manualSession.initial}
            onChat={() => setMode("conversation")}
          />
        </Activity>
      )}
      <Activity mode={mode === "conversation" ? "visible" : "hidden"}>
        <SetupFrame
          contentClassName="justify-start py-6 md:py-10"
          action={
            <Button
              variant="link"
              disabled={busy || conversation.pendingAction !== null}
              onClick={async () => {
                setLoggingOut(true);
                setLogoutError(false);
                try {
                  await Effect.runPromise(account.logout("/setup"));
                } catch {
                  setLogoutError(true);
                } finally {
                  setLoggingOut(false);
                }
              }}
            >
              Log out
            </Button>
          }
        >
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 md:gap-8">
            <div className="grid min-w-0 gap-x-12 gap-y-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center">
              <h1
                id="auth-title"
                tabIndex={-1}
                className="font-display text-5xl leading-none tracking-tight outline-none sm:text-6xl lg:col-start-1 lg:row-start-1 lg:text-7xl"
              >
                Who’s at
                <br className="hidden lg:block" /> your table?
              </h1>
              <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                <FamilyTable
                  creatorName={account.user.name}
                  roster={roster}
                  stage={tableStage(
                    committedFamily,
                    opening || conversation.actionState?._tag === "Pending",
                    conversation.actionState?._tag === "Unknown"
                  )}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-2">
                <FamilySetupChatHistory />
                <FamilySetupConversationError />
                {navigationError && (
                  <OperationError>
                    Your family is saved, but the next step couldn’t open. Try
                    continuing again.
                  </OperationError>
                )}
                {navigationError && committedFamily && (
                  <Button
                    variant="link"
                    disabled={busy}
                    onClick={() => {
                      void continueToFood(committedFamily);
                    }}
                  >
                    Continue with saved family
                  </Button>
                )}
                {logoutError && (
                  <OperationError>
                    Log out didn’t finish. Try again.
                  </OperationError>
                )}
                <FamilySetupChatComposer />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="link"
                disabled={
                  busy ||
                  conversation.pendingAction !== null ||
                  conversation.recoveryBlocked
                }
                onClick={() => {
                  setManualSession((current) => current ?? { initial: roster });
                  setMode("manual");
                }}
              >
                Add manually instead
              </Button>
              <JoinedFamilies
                families={families.data}
                busy={busy}
                onSelect={openExistingFamily}
              />
            </div>
          </div>
        </SetupFrame>
      </Activity>
    </FamilySetupChat>
  );
};

export const FamilySetupPage = () => {
  const account = useAccount();
  return (
    <AgentConversationProvider accountId={account.user.id} scope={setupScope}>
      <FamilyConversationSetup />
    </AgentConversationProvider>
  );
};
