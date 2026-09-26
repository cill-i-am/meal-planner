import type { HouseholdPerson } from "@meal-planner/household-api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";

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
import {
  onboardingRosterQueryOptions,
  setupEffectQuery,
} from "./onboarding-people.js";
import {
  RosterActions,
  RosterManagementOverlay,
  useRosterManagement,
} from "./roster-management.js";
import { useSetup } from "./setup-context.js";
import { SetupError, SetupFrame, SetupStatus } from "./setup-ui.js";

export const useSetupRoster = () => {
  const setup = useSetup();
  const { checkpoint } = setup.progress;
  const organizationId =
    "organizationId" in checkpoint ? checkpoint.organizationId : undefined;
  return useQuery(onboardingRosterQueryOptions(setup.user.id, organizationId));
};

const personStatus = (person: HouseholdPerson): string => {
  if (person.isCurrentAdult) {
    return "You";
  }
  if (person.kind === "dependant") {
    return "Child";
  }
  if (person.associationState === "linked") {
    return "Joined";
  }
  if (person.associationState === "invitation_declined") {
    return "Invitation declined";
  }
  if (person.associationState === "invitation_unavailable") {
    return "Invitation unavailable";
  }
  if (person.associationState === "invitation_pending") {
    return "Invitation pending";
  }
  return "Adult";
};

export const PersonRow = ({ person }: { readonly person: HouseholdPerson }) => (
  <div className="flex items-center gap-3 py-2">
    <Avatar size="lg" aria-hidden="true">
      <AvatarFallback tone={person.kind === "adult" ? "lilac" : "peach"}>
        {[...person.displayName][0]}
      </AvatarFallback>
    </Avatar>
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{person.displayName}</span>
      <span className="text-muted-foreground text-sm">
        {personStatus(person)}
      </span>
    </div>
  </div>
);

export const FamilyReviewPage = () => {
  const setup = useSetup();
  const navigate = useNavigate();
  const roster = useSetupRoster();
  const { checkpoint } = setup.progress;
  const manage = useRosterManagement();
  const action = useMutation(
    setupEffectQuery.mutationOptions({
      mutationFn: (destination: "ready" | "logout" | "people") => {
        if (checkpoint.stage !== "family-review") {
          return Effect.void;
        }
        if (destination === "logout") {
          return setup.logout({ checkpoint, status: "paused" });
        }
        if (destination === "people") {
          return setup.save({
            checkpoint: {
              draft: {
                email: "",
                invite: false,
                name: "",
                participation: "adult",
              },
              organizationId: checkpoint.organizationId,
              stage: "person-draft",
            },
            status: "active",
          });
        }
        return setup.save({
          checkpoint: { ...checkpoint, stage: "ready" },
          status: "active",
        });
      },
      mutationKey: ["setup-family-review"],
      onSuccess: (_result, destination) =>
        destination === "logout"
          ? undefined
          : navigate({
              to: destination === "people" ? "/setup/people" : "/setup/ready",
            }),
    })
  );
  const pendingAction = action.isPending || manage.managing;
  if (roster.isPending) {
    return <SetupStatus title="Loading your family…" />;
  }
  return (
    <SetupFrame
      step="people"
      action={
        <Button
          variant="link"
          disabled={pendingAction}
          onClick={() => action.mutate("logout")}
        >
          {action.isPending && action.variables === "logout"
            ? "Logging out…"
            : "Log out"}
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
                {roster.isError ? "Your family didn’t load" : "Your family"}
              </h1>
            </CardTitle>
            <CardDescription>
              {roster.isError
                ? "Your setup is still here. Try loading your family again."
                : "Check everyone is included."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {roster.data?.people.map((person) => (
              <div key={person.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <PersonRow person={person} />
                </div>
                {roster.data && (
                  <RosterActions
                    person={person}
                    roster={roster.data}
                    organizer={
                      "organizationId" in checkpoint &&
                      setup.isFamilyOrganizer(checkpoint.organizationId)
                    }
                    disabled={pendingAction}
                    onAction={(kind, target) =>
                      manage.begin({
                        kind,
                        person: target,
                        returnTo: { stage: "family-review" },
                      })
                    }
                  />
                )}
              </div>
            ))}
            {roster.data && roster.data.currentPersonId === null && (
              <SetupError>
                Your account is not linked to a person in this family. Open your
                invitation to finish joining.
              </SetupError>
            )}
            {action.error && (
              <SetupError>
                {action.variables === "logout"
                  ? "We couldn’t save your place or log you out. Try again."
                  : "We couldn’t save your place. Try again."}
              </SetupError>
            )}
            {roster.isError ? (
              <Button
                onClick={() => {
                  void roster.refetch();
                }}
              >
                Try again
              </Button>
            ) : (
              <PendingButton
                disabled={pendingAction || !roster.data?.currentPersonId}
                pending={action.isPending && action.variables === "ready"}
                pendingLabel="Continuing…"
                onClick={() => action.mutate("ready")}
              >
                Continue
              </PendingButton>
            )}
          </CardContent>
        </CardBody>
        {roster.data?.currentPersonId && (
          <CardFooter>
            <Button
              variant="link"
              disabled={pendingAction}
              onClick={() => action.mutate("people")}
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
  const setup = useSetup();
  const navigate = useNavigate();
  const roster = useSetupRoster();
  const { checkpoint } = setup.progress;
  const family = setup.families.find(
    (item) =>
      "organizationId" in checkpoint && item.id === checkpoint.organizationId
  );
  const finish = useMutation(
    setupEffectQuery.mutationOptions({
      mutationFn: (destination: "discovery" | "later" | "logout") => {
        if (checkpoint.stage !== "ready") {
          return Effect.void;
        }
        if (destination === "logout") {
          return setup.logout({ checkpoint, status: "paused" });
        }
        return setup.save({
          checkpoint: { ...checkpoint, stage: "complete" },
          status: "active",
        });
      },
      mutationKey: ["setup-family-ready"],
      onSuccess: (_result, destination) =>
        destination === "logout"
          ? undefined
          : navigate({
              href: destination === "discovery" ? "/#private-interviews" : "/",
            }),
    })
  );
  if (roster.isPending) {
    return <SetupStatus title="Loading your family…" />;
  }
  if (roster.isError) {
    return (
      <SetupStatus
        title="Your family didn’t load"
        retry={() => roster.refetch()}
        action={
          <Button
            variant="link"
            disabled={finish.isPending}
            onClick={() => finish.mutate("logout")}
          >
            {finish.isPending ? "Logging out…" : "Log out"}
          </Button>
        }
      >
        {finish.error && (
          <SetupError>
            We couldn’t save your place or log you out. Try again.
          </SetupError>
        )}
      </SetupStatus>
    );
  }
  return (
    <SetupFrame
      step="ready"
      action={
        <Button
          variant="link"
          disabled={finish.isPending}
          onClick={() => finish.mutate("logout")}
        >
          {finish.isPending && finish.variables === "logout"
            ? "Logging out…"
            : "Log out"}
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
                {roster.data.people.map((person) => (
                  <Avatar key={person.id} size="lg" aria-hidden="true">
                    <AvatarFallback
                      tone={person.kind === "adult" ? "lilac" : "peach"}
                    >
                      {[...person.displayName][0]}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              <span className="font-medium">{family?.name}</span>
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
            {finish.error && (
              <SetupError>
                {finish.variables === "logout"
                  ? "We couldn’t save your place or log you out. Try again."
                  : "We couldn’t open your workspace. Try again."}
              </SetupError>
            )}
            <PendingButton
              disabled={finish.isPending}
              pending={finish.isPending && finish.variables === "discovery"}
              pendingLabel="Opening your workspace…"
              onClick={() => finish.mutate("discovery")}
            >
              Tell us how you eat
            </PendingButton>
          </CardContent>
        </CardBody>
        <CardFooter>
          <Button
            variant="link"
            disabled={finish.isPending}
            onClick={() => finish.mutate("later")}
          >
            I’ll do this later
          </Button>
        </CardFooter>
      </Card>
    </SetupFrame>
  );
};
