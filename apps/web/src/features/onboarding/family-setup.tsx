import type {
  ConversationBlock,
  ConversationActionState,
  ReviewedRoster,
} from "@meal-planner/agent-conversations-api";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { useState } from "react";

import { OperationError } from "../../components/operation-error.js";
import { Button } from "../../components/ui/button.js";
import {
  AgentConversationProvider,
  FamilySetupConversationSurface,
  useAgentConversation,
} from "../agent-conversations/index.js";
import { useAccount } from "../auth/index.js";
import { useFamilyActions, useFamilyList } from "../family/index.js";
import { FamilyRosterEditor } from "./family-proposal-review.js";
import { ManualFamilySetup } from "./manual-family-setup.js";
import { SetupFrame } from "./setup-ui.js";

type RosterProposal = Extract<
  ConversationBlock,
  { readonly _tag: "RosterProposal" }
>;
const setupScope = { _tag: "AccountPrivateSetup" } as const;

const FamilyConversationSetup = ({
  onManual,
}: {
  readonly onManual: () => void;
}) => {
  const account = useAccount();
  const conversation = useAgentConversation();
  const families = useFamilyList();
  const actions = useFamilyActions();
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const [navigationError, setNavigationError] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const proposals =
    conversation.view?.blocks.filter(
      (block): block is RosterProposal =>
        block._tag === "RosterProposal" &&
        (block.status === "proposed" || block.status === "pending")
    ) ?? [];
  const proposal = proposals.at(-1);
  const actionBusy = conversation.actionState?._tag === "Pending";
  const busy = opening || loggingOut || actionBusy;

  const openReview = async (familyId: HouseholdOrganizationId) => {
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
  const handleActionResult = async (state: ConversationActionState | null) => {
    if (state?._tag === "Committed" && state.familyId) {
      await openReview(state.familyId);
    }
  };
  const accept = async (reviewed: ReviewedRoster) => {
    if (!proposal) {
      return;
    }
    const result = await conversation.act(proposal, "accept", reviewed);
    await handleActionResult(result);
  };
  const retry = async () => {
    const result = await conversation.retryAction();
    await handleActionResult(result);
  };

  return (
    <SetupFrame
      step="family"
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
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-14 md:px-10 md:py-20">
        <div className="flex min-w-0 flex-col items-start gap-6">
          <div className="flex flex-col gap-5">
            <h1
              id="auth-title"
              tabIndex={-1}
              className="font-display text-5xl leading-none tracking-tight outline-none md:text-7xl"
            >
              Who’s at
              <br />
              your table?
            </h1>
            <p className="text-muted-foreground max-w-lg text-base leading-7">
              Tell me who you’re feeding. We’ll build your family together.
            </p>
          </div>
          <Button
            variant="link"
            disabled={busy || conversation.pendingAction !== null}
            onClick={onManual}
          >
            Set up without chat
          </Button>
          {conversation.status === "unavailable" && (
            <OperationError>
              Chat is unavailable just now. You can still set up your family
              yourself.
            </OperationError>
          )}
          {conversation.status !== "unavailable" && (
            <FamilySetupConversationSurface conversation={conversation} />
          )}
          {families.data && families.data.length > 0 && (
            <div className="flex w-full flex-col gap-2">
              <p className="text-muted-foreground text-sm">
                Or continue with a family you’ve already joined:
              </p>
              {families.data.map((family) => (
                <Button
                  key={family.id}
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    void openReview(family.id);
                  }}
                >
                  {family.name}
                </Button>
              ))}
            </div>
          )}
          {navigationError && (
            <OperationError>
              Your family is saved, but we couldn’t open the review. Try again.
            </OperationError>
          )}
          {conversation.actionState?._tag === "Committed" &&
            conversation.actionState.familyId && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const savedFamilyId = conversation.actionState;
                  if (
                    savedFamilyId?._tag === "Committed" &&
                    savedFamilyId.familyId
                  ) {
                    void openReview(savedFamilyId.familyId);
                  }
                }}
              >
                Open saved family
              </Button>
            )}
          {logoutError && (
            <OperationError>We couldn’t log you out. Try again.</OperationError>
          )}
        </div>
        <div className="min-w-0 md:sticky md:top-6 md:self-start">
          {proposal ? (
            <FamilyRosterEditor
              key={`${proposal.id}:${proposal.revision}`}
              initial={{
                creatorName: proposal.creatorName,
                familyName: proposal.familyName,
                people: proposal.people,
              }}
              onAccept={accept}
              onRetry={retry}
              actionState={conversation.actionState}
              busy={busy}
              error={conversation.error}
            />
          ) : (
            <div className="border-input bg-muted/30 flex min-h-80 flex-col items-center justify-center gap-4 rounded-full border border-dashed px-8 text-center">
              <span
                aria-hidden="true"
                className="bg-person-lilac font-display flex size-20 items-center justify-center rounded-full text-5xl"
              >
                ?
              </span>
              <h2 className="font-display text-3xl">Your table starts here</h2>
              <p className="text-muted-foreground text-sm">
                A description is enough to begin.
              </p>
            </div>
          )}
        </div>
      </div>
    </SetupFrame>
  );
};

/** Signed-in entry keeps chat optional while both paths use reviewed family details. */
export const FamilySetupPage = () => {
  const account = useAccount();
  const [mode, setMode] = useState<"conversation" | "manual">("conversation");
  return mode === "manual" ? (
    <ManualFamilySetup onChat={() => setMode("conversation")} />
  ) : (
    <AgentConversationProvider accountId={account.user.id} scope={setupScope}>
      <FamilyConversationSetup onManual={() => setMode("manual")} />
    </AgentConversationProvider>
  );
};
