import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";

import { useAppForm } from "../../components/forms/form.js";
import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { FieldGroup } from "../../components/ui/field.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import {
  useAuthClient,
  accountKey,
  AuthRequestError,
  authFeedback,
  useAuthRetry,
  EntryFormSurface,
  EntryLayout,
} from "../auth/index.js";
import { RecoveryCard } from "./recovery-card.js";
import {
  RecoveryRequest,
  NewPassword,
  requestValidator,
  passwordValidator,
} from "./recovery-input.js";
import {
  requestPasswordResetMutationOptions,
  resetPasswordMutationOptions,
} from "./recovery-operations.js";

const LoginLink = ({ redirect }: { readonly redirect: string }) => (
  <Button
    variant="link"
    className="h-11 px-0 text-sm"
    nativeButton={false}
    role="link"
    render={<Link to="/login" search={{ redirect }} />}
  >
    Back to log in
  </Button>
);
const Feedback = ({ error }: { readonly error: Error | null }) =>
  error && (
    <Alert variant="destructive" className="mt-4">
      <AlertDescription>
        {error instanceof AuthRequestError &&
        error.code === "RESET_PASSWORD_DISABLED"
          ? "You can’t reset your password right now. Please try again later."
          : authFeedback(error, false)?.message}
      </AlertDescription>
    </Alert>
  );

export const RecoveryRequestPage = ({
  redirect,
}: {
  readonly redirect: string;
}) => {
  const auth = useAuthClient();
  const request = useMutation(
    requestPasswordResetMutationOptions(auth, redirect)
  );
  const requestError =
    request.error?._tag === "EffectQueryFailure"
      ? request.error.match<Error | null>({
          OrElse: () => request.error,
          RecoveryFailure: (failure) => failure.authError,
        })
      : request.error;
  const { waiting } = useAuthRetry(requestError);
  const form = useAppForm({
    defaultValues: { email: "" },
    listeners: {
      onChange: () => {
        if (!waiting && request.isError) {
          request.reset();
        }
      },
    },
    onSubmit: async ({ value }) => {
      if (waiting || request.isPending) {
        return;
      }
      try {
        await request.mutateAsync(
          Schema.decodeUnknownSync(RecoveryRequest)(value).email
        );
      } catch {
        /* Mutation state renders the request failure. */
      }
    },
    validators: { onChange: requestValidator, onSubmit: requestValidator },
  });
  if (request.isSuccess) {
    return (
      <RecoveryCard
        key="sent"
        title="Check your email"
        description="If an account uses this email, we’ll send a reset link."
        footer={
          <Button variant="link" onClick={() => request.reset()}>
            Use another email
          </Button>
        }
      >
        <Button
          className="w-full"
          nativeButton={false}
          role="link"
          render={<Link to="/login" search={{ redirect }} />}
        >
          Back to log in
        </Button>
      </RecoveryCard>
    );
  }
  return (
    <EntryLayout>
      <EntryFormSurface className="mx-auto pt-26 md:pt-31">
        <form.AppForm>
          <form.Frame
            pending={request.isPending}
            className="max-w-none"
            variant="plain"
          >
            <div className="flex flex-col">
              <div className="flex flex-col gap-6 pb-10">
                <form.Heading
                  errorTitle="Reset your password"
                  rejected={request.isError}
                  variant="plain"
                  className="font-display text-entry-mobile tracking-entry md:text-entry-desktop font-normal motion-safe:[view-transition-name:auth-heading]"
                >
                  Let’s get you <br />
                  back in.
                </form.Heading>
                <p className="text-muted-foreground text-sm leading-5.75">
                  Enter your email and we’ll send a link
                  <br className="hidden sm:block" /> to reset your password.
                </p>
              </div>
              <div className="flex flex-col">
                <form.AppField name="email">
                  {(field) => (
                    <field.TextField
                      id="recovery-email"
                      label="Email"
                      type="email"
                      autoComplete="email"
                      disabled={request.isPending}
                    />
                  )}
                </form.AppField>
                <Feedback error={requestError} />
                <PendingButton
                  className="mt-12 w-full md:mt-8"
                  type="submit"
                  disabled={waiting}
                  pending={request.isPending}
                  pendingLabel="Sending reset link…"
                >
                  Send reset link
                </PendingButton>
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              <LoginLink redirect={redirect} />
            </div>
          </form.Frame>
        </form.AppForm>
      </EntryFormSurface>
    </EntryLayout>
  );
};

export const ResetPasswordPage = ({
  redirect,
  token,
  error,
}: {
  readonly redirect: string;
  readonly token: string | undefined;
  readonly error: string | undefined;
}) => {
  const auth = useAuthClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reset = useMutation({
    ...resetPasswordMutationOptions(auth, token),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(accountKey, null);
    },
  });
  const resetError =
    reset.error?._tag === "EffectQueryFailure"
      ? reset.error.match<Error | null>({
          OrElse: () => reset.error,
          RecoveryFailure: (failure) => failure.authError,
        })
      : reset.error;
  const { waiting } = useAuthRetry(resetError);
  const form = useAppForm({
    defaultValues: { confirmation: "", password: "" },
    listeners: {
      onChange: () => {
        if (!waiting && reset.isError) {
          reset.reset();
        }
      },
    },
    onSubmit: async ({ value, formApi }) => {
      if (waiting || reset.isPending) {
        return;
      }
      try {
        await reset.mutateAsync(
          Schema.decodeUnknownSync(NewPassword)(value).password
        );
        formApi.reset();
        await navigate({
          replace: true,
          search: { error: undefined, redirect, token: undefined },
          to: "/reset-password",
        });
      } catch {
        /* Mutation state renders the failure; preserve the in-memory form. */
      }
    },
    validators: { onChange: passwordValidator, onSubmit: passwordValidator },
  });
  if (reset.isSuccess) {
    return (
      <RecoveryCard
        key="updated"
        title="Password updated"
        description="You can now log in with your new password."
      >
        <Button
          className="w-full"
          nativeButton={false}
          role="link"
          render={<Link to="/login" search={{ redirect }} />}
        >
          Log in
        </Button>
      </RecoveryCard>
    );
  }
  if (
    !token ||
    error ||
    (resetError instanceof AuthRequestError &&
      ["INVALID_TOKEN", "USER_NOT_FOUND"].includes(resetError.code ?? ""))
  ) {
    return (
      <RecoveryCard
        key="invalid"
        title="This reset link is no longer valid"
        description="Request a new link to reset your password."
        footer={<LoginLink redirect={redirect} />}
      >
        <Button
          className="w-full"
          nativeButton={false}
          role="link"
          render={<Link to="/forgot-password" search={{ redirect }} />}
        >
          Request a new link
        </Button>
      </RecoveryCard>
    );
  }
  return (
    <EntryLayout>
      <EntryFormSurface className="mx-auto pt-26 md:pt-31">
        <form.AppForm>
          <form.Frame
            pending={reset.isPending}
            className="max-w-none"
            variant="plain"
          >
            <div className="flex flex-col">
              <div className="pb-10">
                <form.Heading
                  errorTitle="Choose a new password"
                  rejected={reset.isError}
                  variant="plain"
                  className="font-display text-entry-mobile tracking-entry md:text-entry-desktop font-normal motion-safe:[view-transition-name:auth-heading]"
                >
                  Choose a new password
                </form.Heading>
              </div>
              <div className="flex flex-col">
                <FieldGroup>
                  <form.AppField name="password">
                    {(field) => (
                      <field.PasswordField
                        id="reset-password"
                        label="New password"
                        autoComplete="new-password"
                        description="At least 8 characters."
                        disabled={reset.isPending}
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="confirmation">
                    {(field) => (
                      <field.PasswordField
                        id="reset-confirmation"
                        label="Confirm new password"
                        autoComplete="new-password"
                        disabled={reset.isPending}
                      />
                    )}
                  </form.AppField>
                </FieldGroup>
                <Feedback error={resetError} />
                <PendingButton
                  className="mt-8 w-full"
                  type="submit"
                  disabled={waiting}
                  pending={reset.isPending}
                  pendingLabel="Saving new password…"
                >
                  Save new password
                </PendingButton>
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              <LoginLink redirect={redirect} />
            </div>
          </form.Frame>
        </form.AppForm>
      </EntryFormSurface>
    </EntryLayout>
  );
};
