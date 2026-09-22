import type { HouseholdPerson } from "@meal-planner/household-api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

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
import { useSetup } from "./setup-context.js";
import { SetupError, SetupFrame, SetupStatus } from "./setup-ui.js";

export const useSetupRoster = () => {
  const setup = useSetup();
  const { checkpoint } = setup.progress;
  const organizationId =
    "organizationId" in checkpoint ? checkpoint.organizationId : undefined;
  return useQuery({
    enabled: organizationId !== undefined,
    queryFn: async () => {
      if (organizationId === undefined) {
        throw new Error("A family is required.");
      }
      await setup.selectFamily(organizationId);
      return setup.peopleForFamily(organizationId).list(false);
    },
    queryKey: ["setup-roster", organizationId, setup.user.id],
  });
};

const personStatus = (person: HouseholdPerson): string => {
  if (person.isCurrentAdult) {
    return "You";
  }
  if (person.kind === "dependant") {
    return "Managed profile";
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
  return "Invitation needed";
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
  const invite = useMutation({
    mutationFn: async (person: HouseholdPerson) => {
      if (checkpoint.stage !== "family-review") {
        return;
      }
      await setup.save({
        checkpoint: {
          displayName: person.displayName,
          email: "",
          organizationId: checkpoint.organizationId,
          personId: person.id,
          reason: "not_sent",
          stage: "person-invite-draft",
        },
        status: "active",
      });
      await navigate({ to: "/setup/people" });
    },
  });
  const edit = useMutation({
    mutationFn: async (person: HouseholdPerson) => {
      if (checkpoint.stage !== "family-review") {
        return;
      }
      await setup.save({
        checkpoint: {
          name: person.displayName,
          organizationId: checkpoint.organizationId,
          personId: person.id,
          stage: "person-edit",
          version: person.version,
        },
        status: "active",
      });
      await navigate({ to: "/setup/edit-person" });
    },
  });
  const action = useMutation({
    mutationFn: async (destination: "ready" | "saved" | "people") => {
      if (checkpoint.stage !== "family-review") {
        return;
      }
      if (destination === "saved") {
        await setup.save({ checkpoint, status: "paused" });
        await navigate({ to: "/setup/saved" });
      } else if (destination === "people") {
        await setup.save({
          checkpoint: {
            draft: { email: "", name: "", participation: "" },
            organizationId: checkpoint.organizationId,
            stage: "person-draft",
          },
          status: "active",
        });
        await navigate({ to: "/setup/people" });
      } else {
        await setup.save({
          checkpoint: { ...checkpoint, stage: "ready" },
          status: "active",
        });
        await navigate({ to: "/setup/ready" });
      }
    },
  });
  const pendingAction = [action, edit, invite].some(
    (operation) => operation.isPending
  );
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
          onClick={() => action.mutate("saved")}
        >
          Save & exit
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
                {person.kind === "adult" &&
                  person.associationState === "unlinked" && (
                    <Button
                      variant="link"
                      disabled={pendingAction}
                      aria-label={`Invite ${person.displayName}`}
                      onClick={() => invite.mutate(person)}
                    >
                      Invite
                    </Button>
                  )}
                <Button
                  variant="link"
                  disabled={pendingAction}
                  aria-label={`Edit ${person.displayName}`}
                  onClick={() => edit.mutate(person)}
                >
                  Edit
                </Button>
              </div>
            ))}
            {roster.data && roster.data.currentPersonId === null && (
              <SetupError>
                Your account is not linked to a person in this family. Open your
                invitation to finish joining.
              </SetupError>
            )}
            {(action.error || edit.error || invite.error) && (
              <SetupError>We couldn’t save your place. Try again.</SetupError>
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
              <Button
                disabled={pendingAction || !roster.data?.currentPersonId}
                onClick={() => action.mutate("ready")}
              >
                Continue
              </Button>
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
  const finish = useMutation({
    mutationFn: async (destination: "discovery" | "later" | "saved") => {
      if (checkpoint.stage !== "ready") {
        return;
      }
      if (destination === "saved") {
        await setup.save({ checkpoint, status: "paused" });
        await navigate({ to: "/setup/saved" });
        return;
      }
      await setup.selectFamily(checkpoint.organizationId);
      await setup.save({
        checkpoint: { ...checkpoint, stage: "complete" },
        status: "active",
      });
      await navigate({
        href: destination === "discovery" ? "/#private-interviews" : "/",
      });
    },
  });
  if (roster.isPending) {
    return <SetupStatus title="Loading your family…" />;
  }
  if (roster.isError) {
    return (
      <SetupStatus
        title="Your family didn’t load"
        retry={() => roster.refetch()}
      />
    );
  }
  return (
    <SetupFrame
      step="ready"
      action={
        <Button
          variant="link"
          disabled={finish.isPending}
          onClick={() => finish.mutate("saved")}
        >
          Save & exit
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
                {finish.variables === "saved"
                  ? "We couldn’t save your place. Try again."
                  : "We couldn’t open your workspace. Try again."}
              </SetupError>
            )}
            <Button
              disabled={finish.isPending}
              onClick={() => finish.mutate("discovery")}
            >
              Tell us how you eat
            </Button>
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
