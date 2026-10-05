import type { ReviewedRoster } from "@meal-planner/agent-conversations-api";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { useState } from "react";

import { OperationError } from "../../components/operation-error.js";
import { Button } from "../../components/ui/button.js";
import { useAccount } from "../auth/index.js";
import {
  useFamilyActions,
  useFamilyList,
  useManualFamilyCreation,
} from "../family/index.js";
import { FamilyRosterEditor } from "./family-proposal-review.js";
import { SetupFrame } from "./setup-ui.js";

export const ManualFamilySetup = ({
  onChat,
  initial,
}: {
  readonly onChat: () => void;
  readonly initial?: ReviewedRoster | null;
}) => {
  const account = useAccount();
  const actions = useFamilyActions();
  const families = useFamilyList();
  const navigate = useNavigate();
  const manual = useManualFamilyCreation();
  const [navigationError, setNavigationError] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [opening, setOpening] = useState(false);
  const existingFamilies =
    families.data?.filter((family) => family.id !== manual.familyId) ?? [];

  const openReview = async (familyId: NonNullable<typeof manual.familyId>) => {
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
  const save = async (reviewed: ReviewedRoster) => {
    const familyId = await manual.submit(reviewed);
    if (familyId) {
      await openReview(familyId);
    }
  };
  const retry = async () => {
    const familyId = await manual.retry();
    if (familyId) {
      await openReview(familyId);
    }
  };
  const busy = manual.state === "pending" || opening || loggingOut;
  return (
    <SetupFrame
      contentClassName="justify-start py-6 md:py-10"
      action={
        <Button
          variant="link"
          disabled={busy || manual.state === "unknown"}
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
      <div className="mx-auto grid w-full max-w-7xl gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-14">
        <div className="flex flex-col items-start gap-6">
          <h1
            id="manual-family-title"
            tabIndex={-1}
            className="font-display text-5xl leading-none tracking-tight outline-none md:text-7xl"
          >
            Who’s at
            <br className="hidden lg:block" />
            your table?
          </h1>
          <p className="text-muted-foreground max-w-lg text-base leading-7">
            {initial
              ? "Edit your table’s draft here. Your changes stay here when you return to the conversation."
              : "Add everyone you plan meals for. Check the details, then create your family."}
          </p>
          <Button
            variant="link"
            disabled={busy || manual.state === "unknown"}
            onClick={onChat}
          >
            Return to conversation
          </Button>
          {manual.familyId && manual.state === "unknown" && (
            <OperationError>
              Your family is saved. {manual.savedPeople}{" "}
              {manual.savedPeople === 1 ? "person is" : "people are"} confirmed
              so far. Check and continue to retry the same remaining request.
            </OperationError>
          )}
          {manual.familyId && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                const savedFamilyId = manual.familyId;
                if (savedFamilyId) {
                  void openReview(savedFamilyId);
                }
              }}
            >
              Open saved family
            </Button>
          )}
          {existingFamilies.length > 0 && (
            <div className="flex w-full flex-col gap-2">
              <p className="text-muted-foreground text-sm">
                Or continue with a family you’ve already joined:
              </p>
              {existingFamilies.map((family) => (
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
              Your family is saved, but we couldn’t open its review. Try again.
            </OperationError>
          )}
          {logoutError && (
            <OperationError>We couldn’t log you out. Try again.</OperationError>
          )}
        </div>
        <FamilyRosterEditor
          initial={
            initial ?? {
              creatorName: account.user.name,
              familyName: "",
              people: [],
            }
          }
          onAccept={save}
          onRetry={retry}
          status={manual.state}
          busy={busy}
          error={manual.errorMessage}
        />
      </div>
    </SetupFrame>
  );
};
