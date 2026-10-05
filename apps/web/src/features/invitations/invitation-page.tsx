import { InvitationId } from "@meal-planner/household-api";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";
import type { ReactNode } from "react";
import { useState } from "react";

import { AccountLayout } from "../../components/account-layout.js";
import { OperationError } from "../../components/operation-error.js";
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
import { useApiRuntime } from "../api-client/index.js";
import { AccountProvider, useAccount } from "../auth/index.js";
import { useInvitationResponse } from "./invitation-mutation.js";
import { invitationReadQueryOptions } from "./invitation-operations.js";

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
  <AccountLayout headerAction={action}>
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
  </AccountLayout>
);

const InvitationReadFailure = ({
  reason,
  email,
  busy,
  header,
  failure,
  logout,
  retry,
  recover,
}: {
  readonly reason: "unauthorized" | "wrong-account" | "unavailable" | "other";
  readonly email: string;
  readonly busy: boolean;
  readonly header: ReactNode;
  readonly failure: ReactNode;
  readonly logout: () => void;
  readonly retry: () => Promise<unknown>;
  readonly recover: ReactNode;
}) => {
  if (reason === "unauthorized") {
    return (
      <InvitationCard
        title="Your account changed"
        description="Reload to check your current account before responding to this invitation."
      >
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </InvitationCard>
    );
  }
  const wrongAccount = reason === "wrong-account";
  const unavailable = reason === "unavailable";
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

export const InvitationPage = ({
  invitationId,
}: {
  readonly invitationId: InvitationId;
}) => {
  const account = useAccount();
  const runtime = useApiRuntime();
  const navigate = useNavigate();
  const invitation = useQuery(
    invitationReadQueryOptions(runtime, invitationId, account.user.id)
  );
  const respond = useInvitationResponse(invitationId);
  const [actionError, setActionError] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const busy = respond.isPending || finishing;
  const logout = async () => {
    setFinishing(true);
    try {
      await Effect.runPromise(account.logout(`/invitation/${invitationId}`));
    } catch {
      setActionError("We couldn’t sign you out. Try again.");
    } finally {
      setFinishing(false);
    }
  };
  const submit = async (decision: "accept" | "decline") => {
    setActionError(undefined);
    setFinishing(true);
    try {
      const result = await respond.submit(decision);
      await navigate({
        search: {},
        to: result.status === "joined" ? "/" : "/setup",
      });
    } catch {
      setActionError(
        "We couldn’t finish that action. Try again to check the same response."
      );
      await invitation.refetch();
    } finally {
      setFinishing(false);
    }
  };
  const header = (
    <Button
      variant="link"
      disabled={busy}
      onClick={() => {
        void logout();
      }}
    >
      Switch account
    </Button>
  );
  const failure = actionError && <OperationError>{actionError}</OperationError>;
  const recoveryAction = (
    <Button
      disabled={busy}
      onClick={() => {
        void navigate({ to: "/setup" });
      }}
    >
      Back to your account
    </Button>
  );
  if (invitation.isPending) {
    return <InvitationCard title="Loading your invitation…" />;
  }
  if (invitation.isError) {
    return (
      <InvitationReadFailure
        reason={invitation.error.match({
          InvitationReadForbidden: () => "wrong-account" as const,
          InvitationReadNotFound: () => "unavailable" as const,
          InvitationReadUnauthorized: () => "unauthorized" as const,
          OrElse: () => "other" as const,
        })}
        email={account.user.email}
        busy={busy}
        header={header}
        failure={failure}
        logout={() => {
          void logout();
        }}
        retry={() => invitation.refetch()}
        recover={recoveryAction}
      />
    );
  }
  const view = invitation.data;
  if (
    view.status === "expired" ||
    view.status === "canceled" ||
    view.status === "rejected"
  ) {
    return (
      <InvitationCard
        title={
          view.status === "rejected"
            ? "Invitation declined"
            : "This invitation is no longer available"
        }
        description="Ask the family organiser for a new invitation if you want to join."
        action={header}
      >
        {failure}
        {recoveryAction}
      </InvitationCard>
    );
  }
  if (
    respond.pendingRequest?.decision === "decline" &&
    view.status === "accepted"
  ) {
    return (
      <InvitationCard
        title="This invitation was accepted"
        description="It was accepted in another session. You can finish joining this family."
        action={header}
      >
        {failure}
        <Button disabled={busy} onClick={respond.continueAcceptedInvitation}>
          Continue with the accepted invitation
        </Button>
      </InvitationCard>
    );
  }
  if (respond.pendingRequest || view.status === "accepted") {
    return (
      <InvitationCard
        title={
          respond.pendingRequest?.decision === "decline"
            ? "Finish declining your invitation"
            : "Finish joining your family"
        }
        description="Check the result of your response to continue."
        action={header}
      >
        {failure}
        <PendingButton
          disabled={busy}
          pending={busy}
          pendingLabel="Finishing invitation…"
          onClick={() => {
            void submit(respond.pendingRequest?.decision ?? "accept");
          }}
        >
          Continue
        </PendingButton>
      </InvitationCard>
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
          onClick={() => {
            void submit("decline");
          }}
        >
          Decline invitation
        </Button>
      }
    >
      <div className="flex items-center gap-3">
        <Avatar size="lg" aria-hidden="true">
          <AvatarFallback tone="blue">
            {[...account.user.name][0]}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <span>{account.user.name}</span>
          <span className="text-muted-foreground text-sm wrap-anywhere">
            Joining as {account.user.email}
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
        pending={busy}
        pendingLabel="Joining family…"
        onClick={() => {
          void submit("accept");
        }}
      >
        Join family
      </PendingButton>
    </InvitationCard>
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
    <AccountProvider>
      <InvitationPage key={parsed.value} invitationId={parsed.value} />
    </AccountProvider>
  ) : (
    <InvitationCard
      title="This invitation is no longer available"
      description="Ask the family organiser for a new invitation."
    />
  );
};
