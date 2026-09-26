import type { InvitationView } from "@meal-planner/household-api";
import { InvitationId, SetupCheckpoint } from "@meal-planner/household-api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Option, Schema } from "effect";
import type { ReactNode } from "react";

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
import { Separator } from "../../components/ui/separator.js";
import { AuthRequestError } from "../auth/auth-errors.js";
import { AuthLayout } from "../auth/auth-layout.js";
import { SetupProvider, useSetup } from "../onboarding/setup-context.js";
import { SetupError } from "../onboarding/setup-ui.js";
import { completeInvitation, readInvitation } from "./invitation-operations.js";
import type { InvitationCommand } from "./invitation-operations.js";

const InvitationCard = ({
  title,
  description,
  children,
  footer,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly action?: ReactNode;
}) => (
  <AuthLayout headerAction={action}>
    <Card className="w-full max-w-(--container-auth)">
      <CardBody>
        <CardHeader>
          <CardTitle>
            <h1
              id="auth-title"
              tabIndex={-1}
              className="text-task-mobile/8 md:text-task-desktop/9 font-semibold tracking-tight focus:outline-none"
            >
              {title}
            </h1>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </CardBody>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  </AuthLayout>
);

const InvitationReadFailure = ({
  error,
  email,
  busy,
  header,
  failure,
  logout,
  retry,
  recover,
}: {
  readonly error: Error;
  readonly email: string;
  readonly busy: boolean;
  readonly header: ReactNode;
  readonly failure: ReactNode;
  readonly logout: () => void;
  readonly retry: () => Promise<unknown>;
  readonly recover: ReactNode;
}) => {
  if (error instanceof AuthRequestError && error.status === 401) {
    return (
      <InvitationCard
        title="Your account changed"
        description="Reload to check your current account before responding to this invitation."
      >
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </InvitationCard>
    );
  }
  const wrongAccount =
    error instanceof AuthRequestError &&
    error.code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION";
  const unavailable =
    error instanceof AuthRequestError && error.code === "INVITATION_NOT_FOUND";
  const title = wrongAccount
    ? "Use the invited email"
    : "This invitation didn’t load";
  if (unavailable) {
    return (
      <InvitationCard
        title="This invitation is no longer available"
        description="Ask the family organiser for a new invitation."
      >
        {failure}
        {recover}
      </InvitationCard>
    );
  }
  return (
    <InvitationCard
      title={title}
      description={
        wrongAccount
          ? "Switch to the account that received the invitation."
          : "Your invitation is still here. Try loading it again."
      }
      action={wrongAccount ? undefined : header}
    >
      {wrongAccount && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-sm">Signed in as</span>
          <span className="wrap-anywhere">{email}</span>
        </div>
      )}
      {failure}
      <Button
        disabled={busy}
        onClick={() => {
          if (wrongAccount) {
            logout();
          } else {
            void retry();
          }
        }}
      >
        {wrongAccount ? "Switch account" : "Try again"}
      </Button>
    </InvitationCard>
  );
};

const pendingInvitation = (
  checkpoint: SetupCheckpoint
): InvitationCommand | undefined => {
  if (
    checkpoint.stage === "invitation-response" ||
    checkpoint.stage === "invitation-link"
  ) {
    return checkpoint;
  }
  return undefined;
};

const useInvitationFlow = (invitationId: InvitationId) => {
  const setup = useSetup();
  const navigate = useNavigate();
  const { checkpoint } = setup.progress;
  const pending = pendingInvitation(checkpoint);
  const invitation = useQuery({
    queryFn: () => readInvitation(invitationId, setup.user.id),
    queryKey: ["setup-invitation", setup.user.id, invitationId],
    retry: false,
  });
  const respond = useMutation({
    mutationFn: async (command: InvitationCommand) => {
      await setup.save({ checkpoint: command, status: "active" });
      const result = await completeInvitation(command, {
        activate: setup.selectFamily,
        auth: setup.auth,
        people: setup.peopleForFamily(command.organizationId),
        read: () => readInvitation(command.invitationId, setup.user.id),
        save: (next) => setup.save({ checkpoint: next, status: "active" }),
      });
      await (result === "joined"
        ? navigate({ to: "/setup/ready" })
        : invitation.refetch());
    },
    onError: async () => {
      await invitation.refetch();
    },
  });
  const pause = useMutation({
    mutationFn: async (command: InvitationCommand) => {
      await setup.save({ checkpoint: command, status: "paused" });
      await navigate({ to: "/setup/saved" });
    },
  });
  const logout = useMutation({ mutationFn: setup.logout });
  const recover = useMutation({
    mutationFn: async () => {
      if (pending) {
        await setup.save({
          checkpoint: pending.returnCheckpoint,
          status: "active",
        });
      }
      await navigate({ to: "/setup" });
    },
  });
  const busy = [respond, pause, logout, recover].some(
    (operation) => operation.isPending
  );
  const retained =
    pending ?? (respond.isSuccess ? undefined : respond.variables);
  return {
    busy,
    checkpoint,
    invitation,
    logout,
    pause,
    pending,
    recover,
    respond,
    retained,
    setup,
  };
};

const finishLabel = (command: InvitationCommand | undefined) =>
  command?.stage === "invitation-response" && command.decision === "decline"
    ? "Confirm decline"
    : "Finish setup";

const InvitationFinish = ({
  command,
  accepted,
  busy,
  saving,
  header,
  failure,
  finish,
}: {
  readonly command: InvitationCommand | undefined;
  readonly accepted: boolean;
  readonly busy: boolean;
  readonly saving: boolean;
  readonly header: ReactNode;
  readonly failure: ReactNode;
  readonly finish: () => void;
}) => (
  <InvitationCard
    title={
      command?.stage === "invitation-response" && command.decision === "decline"
        ? "Finish declining your invitation"
        : "Finish joining your family"
    }
    description={
      accepted
        ? "You’ve joined. Finish connecting your family profile."
        : "We’ve kept your response. Check its result to finish the same request."
    }
    action={header}
  >
    {failure}
    <PendingButton
      disabled={busy}
      pending={saving}
      pendingLabel="Finishing invitation…"
      onClick={finish}
    >
      {finishLabel(command)}
    </PendingButton>
  </InvitationCard>
);

const InvitationContent = ({
  flow,
  view,
  header,
  failure,
  recoveryAction,
}: {
  readonly flow: ReturnType<typeof useInvitationFlow>;
  readonly view: InvitationView;
  readonly header: ReactNode;
  readonly failure: ReactNode;
  readonly recoveryAction: ReactNode;
}) => {
  const { setup, checkpoint, retained, respond, busy } = flow;

  if (
    view.status === "rejected" &&
    retained?.stage === "invitation-response" &&
    retained.decision === "decline"
  ) {
    return (
      <InvitationCard
        title="Finish saving your response"
        description="Your invitation was declined. Confirm the result to return to your account."
        action={header}
      >
        {failure}
        <PendingButton
          disabled={busy}
          pending={respond.isPending}
          pendingLabel="Saving response…"
          onClick={() => respond.mutate(retained)}
        >
          Continue
        </PendingButton>
      </InvitationCard>
    );
  }
  if (view.status === "rejected") {
    return (
      <InvitationCard
        title="Invitation declined"
        description="You haven’t joined this family. You can ask the organiser for a new invitation if you change your mind."
      >
        {failure}
        {recoveryAction}
      </InvitationCard>
    );
  }
  if (view.status === "expired" || view.status === "canceled") {
    return (
      <InvitationCard
        title="This invitation is no longer available"
        description="Ask the family organiser for a new invitation."
      >
        {failure}
        {recoveryAction}
      </InvitationCard>
    );
  }
  const command = (decision: "accept" | "decline"): InvitationCommand => {
    if (retained) {
      return retained;
    }
    const decoded = Schema.decodeUnknownSync(SetupCheckpoint)({
      decision,
      invitationId: view.id,
      linkMutationId: crypto.randomUUID(),
      organizationId: view.organizationId,
      returnCheckpoint: checkpoint,
      stage: "invitation-response",
    });
    if (decoded.stage !== "invitation-response") {
      throw new Error("Expected invitation response.");
    }
    return decoded;
  };
  if (
    view.status === "accepted" &&
    retained?.stage === "invitation-response" &&
    retained.decision === "decline"
  ) {
    return (
      <InvitationCard
        title="This invitation was accepted"
        description="It was accepted in another session. You can finish connecting your family profile or return to your account."
        footer={recoveryAction}
      >
        {failure}
        <PendingButton
          disabled={busy}
          pending={respond.isPending}
          pendingLabel="Joining family…"
          onClick={() =>
            respond.mutate({
              invitationId: retained.invitationId,
              linkMutationId: retained.linkMutationId,
              organizationId: retained.organizationId,
              returnCheckpoint: retained.returnCheckpoint,
              stage: "invitation-link",
            })
          }
        >
          Finish joining family
        </PendingButton>
      </InvitationCard>
    );
  }
  if (retained || view.status === "accepted") {
    return (
      <InvitationFinish
        command={retained}
        accepted={view.status === "accepted"}
        busy={busy}
        saving={respond.isPending}
        header={header}
        failure={failure}
        finish={() => respond.mutate(command("accept"))}
      />
    );
  }
  return (
    <InvitationCard
      title={`Join ${view.familyName}`}
      description={`${view.inviterName} invited you to join ${view.familyName}.`}
      action={header}
      footer={
        <Button
          variant="link"
          disabled={busy}
          onClick={() => respond.mutate(command("decline"))}
        >
          Decline invitation
        </Button>
      }
    >
      <div className="flex items-center gap-3">
        <Avatar size="lg" aria-hidden="true">
          <AvatarFallback tone="blue">{[...setup.user.name][0]}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <span>{setup.user.name}</span>
          <span className="text-muted-foreground text-sm wrap-anywhere">
            Joining as {setup.user.email}
          </span>
        </div>
      </div>
      <Separator />
      <p className="text-muted-foreground text-center text-sm">
        The family will see the food preferences you choose to share.
      </p>
      {failure}
      <PendingButton
        disabled={busy}
        pending={respond.isPending}
        pendingLabel="Joining family…"
        onClick={() => respond.mutate(command("accept"))}
      >
        Join family
      </PendingButton>
    </InvitationCard>
  );
};

export const InvitationPage = ({
  invitationId,
}: {
  readonly invitationId: InvitationId;
}) => {
  const flow = useInvitationFlow(invitationId);
  const {
    setup,
    checkpoint,
    pending,
    invitation,
    respond,
    pause,
    logout,
    recover,
    busy,
    retained,
  } = flow;
  const header = retained ? (
    <Button
      variant="link"
      disabled={busy}
      onClick={() => pause.mutate(retained)}
    >
      Save & exit
    </Button>
  ) : (
    <Button variant="link" disabled={busy} onClick={() => logout.mutate()}>
      Switch account
    </Button>
  );
  const failure = [
    respond.error,
    pause.error,
    logout.error,
    recover.error,
  ].some((error) => error !== null) && (
    <SetupError>
      We couldn’t confirm that action. Try again to check its result.
    </SetupError>
  );
  const recoveryAction = (
    <PendingButton
      disabled={busy}
      pending={recover.isPending}
      pendingLabel="Returning to account…"
      onClick={() => recover.mutate()}
    >
      Back to your account
    </PendingButton>
  );
  if (
    [
      "family-create",
      "person-create",
      "person-invite",
      "person-rename",
    ].includes(checkpoint.stage)
  ) {
    return (
      <InvitationCard
        title="Finish your saved change first"
        description="Your previous change is still being confirmed. Finish it before responding to this invitation."
      >
        <Button nativeButton={false} role="link" render={<Link to="/setup" />}>
          Continue saved setup
        </Button>
      </InvitationCard>
    );
  }
  if (pending && pending.invitationId !== invitationId) {
    return (
      <InvitationCard
        title="Finish your current invitation"
        description="Your previous response is saved. Finish it before responding to another invitation."
        footer={
          <Button
            variant="link"
            nativeButton={false}
            role="link"
            render={<Link to="/setup/join" />}
          >
            Continue saved invitation
          </Button>
        }
      />
    );
  }
  if (invitation.isPending) {
    return <InvitationCard title="Loading your invitation…" />;
  }
  if (invitation.isError) {
    return (
      <InvitationReadFailure
        error={invitation.error}
        email={setup.user.email}
        busy={busy}
        header={header}
        failure={failure}
        logout={() => logout.mutate()}
        retry={() => invitation.refetch()}
        recover={recoveryAction}
      />
    );
  }
  return (
    <InvitationContent
      flow={flow}
      view={invitation.data}
      header={header}
      failure={failure}
      recoveryAction={recoveryAction}
    />
  );
};

/** Render an invalid route identity as an unavailable invitation. */
export const InvitationPageForRoute = ({
  invitationId,
}: {
  readonly invitationId: string;
}) => {
  const parsed = Schema.decodeUnknownOption(InvitationId)(invitationId);
  return Option.isSome(parsed) ? (
    <SetupProvider>
      <InvitationPage key={parsed.value} invitationId={parsed.value} />
    </SetupProvider>
  ) : (
    <InvitationCard
      title="This invitation is no longer available"
      description="Ask the family organiser for a new invitation."
    />
  );
};
