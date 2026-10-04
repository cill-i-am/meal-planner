import type { Family } from "@meal-planner/families";
import type { HouseholdPeopleRoster } from "@meal-planner/household-api";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { useState } from "react";

import { OperationError } from "../../components/operation-error.js";
import { StatusScreen } from "../../components/status-screen.js";
import { Avatar, AvatarFallback } from "../../components/ui/avatar.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../../components/ui/card.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import { apiEffectQuery } from "../api-client/index.js";
import { useAccount } from "../auth/index.js";
import {
  useCompleteFamilySetup,
  useResumeFamilyCreation,
  useFamilyActions,
  PersonRow,
  useFamilyRoster,
  RosterActions,
  RosterManagementOverlay,
  useRosterManagement,
  useFamily,
} from "../family/index.js";
import { SetupFrame } from "./setup-ui.js";

const useLogout = () => {
  const account = useAccount();
  return useMutation(
    apiEffectQuery.mutationOptions({
      mutationFn: () => account.logout("/setup"),
      mutationKey: ["setup-logout"],
    })
  );
};
const CreatorRecovery = ({ family }: { readonly family: Family }) => {
  const resume = useResumeFamilyCreation(family.id);
  return (
    <div className="flex flex-col gap-3">
      <p>Your family is saved. Finish linking its creator to continue.</p>
      {resume.error && (
        <OperationError>
          We couldn’t finish creating your family. Try again to continue the
          same request.
        </OperationError>
      )}
      <PendingButton
        disabled={resume.isPending}
        pending={resume.isPending}
        pendingLabel="Finishing family creation…"
        onClick={() => resume.mutate()}
      >
        Finish creating family
      </PendingButton>
    </div>
  );
};

const CreatorNotice = ({
  family,
  roster,
}: {
  readonly family: Family;
  readonly roster: HouseholdPeopleRoster;
}) => {
  if (roster.currentPersonId !== null) {
    if (!family.canManage && family.setup.status === "in_progress") {
      return (
        <OperationError>
          Your family organiser needs to finish setup before you continue.
        </OperationError>
      );
    }
    return null;
  }
  if (roster.creatorSlot === "available" && family.canManage) {
    return <CreatorRecovery family={family} />;
  }
  return (
    <OperationError>
      Your account is not linked to a person in this family. Open your
      invitation to finish joining.
    </OperationError>
  );
};

export const FamilyReviewPage = () => {
  const setup = useFamily();
  const roster = useFamilyRoster();
  const navigate = useNavigate();
  const manage = useRosterManagement();
  const logout = useLogout();
  const [navigationFailed, setNavigationFailed] = useState(false);
  const go = async (to: "/setup/people" | "/setup/ready") => {
    try {
      await navigate({
        search: setup.family ? { familyId: setup.family.id } : {},
        to,
      });
    } catch {
      setNavigationFailed(true);
    }
  };
  if (roster.isPending) {
    return <StatusScreen title="Loading your family…" />;
  }
  return (
    <SetupFrame
      step="people"
      action={
        <Button
          variant="link"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          Log out
        </Button>
      }
    >
      <Card className="w-full max-w-140 [--card-spacing:--spacing(4)] md:[--card-spacing:--spacing(10)]">
        <CardBody>
          <CardHeader>
            <CardTitle>
              <h1
                id="auth-title"
                tabIndex={-1}
                className="text-task-mobile/8 md:text-task-desktop/9 font-semibold tracking-tight focus:outline-none"
              >
                Your family
              </h1>
            </CardTitle>
            <CardDescription>Check everyone is included.</CardDescription>
          </CardHeader>
          <CardContent>
            {roster.data?.people.map((person) => (
              <div key={person.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <PersonRow person={person} />
                </div>
                <RosterActions
                  person={person}
                  roster={roster.data}
                  organizer={setup.family?.canManage ?? false}
                  disabled={manage.managing}
                  onAction={(kind, target) =>
                    manage.begin({ kind, person: target })
                  }
                />
              </div>
            ))}
            {roster.isError && (
              <OperationError>
                Your family couldn’t refresh.{" "}
                <Button
                  variant="link"
                  onClick={() => {
                    void roster.refetch();
                  }}
                >
                  Try again
                </Button>
              </OperationError>
            )}
            {roster.data && setup.family && (
              <CreatorNotice family={setup.family} roster={roster.data} />
            )}
            {logout.error && (
              <OperationError>
                We couldn’t log you out. Try again.
              </OperationError>
            )}
            {navigationFailed && (
              <OperationError>
                Your family is saved. Try opening the next screen again.
              </OperationError>
            )}
            <Button
              disabled={
                roster.isError ||
                manage.managing ||
                !roster.data?.currentPersonId
              }
              onClick={() => {
                void go("/setup/ready");
              }}
            >
              Continue
            </Button>
          </CardContent>
        </CardBody>
        {roster.data?.currentPersonId && setup.family?.canManage && (
          <CardFooter>
            <Button
              variant="link"
              disabled={manage.managing}
              onClick={() => {
                void go("/setup/people");
              }}
            >
              Add someone else
            </Button>
          </CardFooter>
        )}
      </Card>
      <RosterManagementOverlay management={manage} />
    </SetupFrame>
  );
};

export const FamilyReadyPage = () => {
  const setup = useFamily();
  const actions = useFamilyActions();
  const { family } = setup;
  const roster = useFamilyRoster();
  const navigate = useNavigate();
  const logout = useLogout();
  const [navigationFailed, setNavigationFailed] = useState(false);
  const finish = useCompleteFamilySetup();
  const complete = async (destination: "discovery" | "later") => {
    if (!family) {
      return;
    }
    if (!finish.isSuccess && family.setup.status !== "complete") {
      try {
        await finish.mutateAsync(family.id);
      } catch {
        return;
      }
    }
    try {
      if (family) {
        await Effect.runPromise(actions.selectFamily(family.id));
      }
      await actions.refresh();
      await navigate({
        href: destination === "discovery" ? "/#private-interviews" : "/",
      });
    } catch {
      setNavigationFailed(true);
    }
  };
  if (roster.isPending) {
    return <StatusScreen title="Loading your family…" />;
  }
  if (!family) {
    return <StatusScreen title="Choose a family to continue" />;
  }
  const busy = finish.isPending || logout.isPending;
  const canFinish =
    !roster.isError &&
    Boolean(roster.data?.currentPersonId) &&
    Boolean(family.canManage || family.setup.status === "complete");
  return (
    <SetupFrame
      step="ready"
      action={
        <Button variant="link" disabled={busy} onClick={() => logout.mutate()}>
          {logout.isPending ? "Logging out…" : "Log out"}
        </Button>
      }
    >
      <Card className="w-full max-w-140 [--card-spacing:--spacing(4)] md:[--card-spacing:--spacing(10)]">
        <CardBody>
          <CardHeader className="text-center">
            <CardTitle>
              <h1
                id="auth-title"
                tabIndex={-1}
                className="text-welcome-mobile/9 md:text-welcome-desktop/13 font-semibold tracking-tight focus:outline-none"
              >
                Your family
                <br />
                is ready.
              </h1>
            </CardTitle>
            <CardDescription>
              Next, tell us how you like to eat.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex flex-wrap justify-center gap-2">
                {roster.data?.people.map((person) => (
                  <Avatar key={person.id} size="lg" aria-hidden="true">
                    <AvatarFallback
                      tone={person.kind === "adult" ? "lilac" : "peach"}
                    >
                      {[...person.displayName][0]}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              <span className="font-medium">{family.name}</span>
              <span className="text-muted-foreground text-sm">
                {roster.data?.people
                  .map((person) => person.displayName)
                  .join(", ")}
              </span>
            </div>
            <p className="text-muted-foreground text-center text-sm">
              Your conversation is private. You choose what to share with your
              family.
            </p>
            {roster.data && (
              <CreatorNotice family={family} roster={roster.data} />
            )}
            {roster.isError && (
              <OperationError>
                Your family couldn’t refresh. Try again before continuing.
              </OperationError>
            )}
            {roster.isError && (
              <Button
                variant="link"
                onClick={() => {
                  void roster.refetch();
                }}
              >
                Try again
              </Button>
            )}
            {finish.error && (
              <OperationError>
                We couldn’t confirm setup is complete. Try again.
              </OperationError>
            )}
            {navigationFailed && (
              <OperationError>
                Setup is complete. Try opening the app again.
              </OperationError>
            )}
            {logout.error && (
              <OperationError>
                We couldn’t log you out. Try again.
              </OperationError>
            )}
            <PendingButton
              disabled={busy || !canFinish}
              pending={finish.isPending}
              pendingLabel="Opening your workspace…"
              onClick={() => {
                void complete("discovery");
              }}
            >
              Tell us how you eat
            </PendingButton>
          </CardContent>
        </CardBody>
        <CardFooter>
          <Button
            variant="link"
            disabled={busy || !canFinish}
            onClick={() => {
              void complete("later");
            }}
          >
            I’ll do this later
          </Button>
        </CardFooter>
      </Card>
    </SetupFrame>
  );
};
