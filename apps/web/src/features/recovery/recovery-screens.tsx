import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";

import { useAppForm } from "../../components/forms/form.js";
import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import {
  CardBody,
  CardHeader,
  CardDescription,
  CardContent,
  CardFooter,
} from "../../components/ui/card.js";
import { FieldGroup } from "../../components/ui/field.js";
import { useAuthClient } from "../auth/auth-client.js";
import { AuthRequestError, authFeedback } from "../auth/auth-errors.js";
import { AuthLayout } from "../auth/auth-layout.js";
import { useAuthRetry } from "../auth/use-auth-retry.js";
import { RecoveryCard } from "./recovery-card.js";
import {
  RecoveryRequest,
  NewPassword,
  requestValidator,
  passwordValidator,
} from "./recovery-input.js";
import { submitRecovery } from "./recovery-operations.js";

const LoginLink = ({ redirect }: { readonly redirect: string }) => (
  <Button
    variant="link"
    nativeButton={false}
    role="link"
    render={<Link to="/login" search={{ redirect }} />}
  >
    Back to log in
  </Button>
);
const Feedback = ({ error }: { readonly error: Error | null }) =>
  error && (
    <Alert variant="destructive">
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
  const request = useMutation({
    mutationFn: async (email: string) => {
      const callback = new URL("/reset-password", window.location.origin);
      callback.searchParams.set("redirect", redirect);
      await submitRecovery((options) =>
        auth.requestPasswordReset({ email, redirectTo: callback.href }, options)
      );
    },
  });
  const { waiting } = useAuthRetry(request.error);
  const form = useAppForm({
    defaultValues: { email: "" },
    listeners: {
      onChange: () => {
        if (!waiting) {
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
    <AuthLayout>
      <form.AppForm>
        <form.Frame pending={request.isPending}>
          <CardBody>
            <CardHeader>
              <form.Heading
                errorTitle="Reset your password"
                rejected={request.isError}
              >
                Reset your password
              </form.Heading>
              <CardDescription>
                We’ll email you a link to reset your password.
              </CardDescription>
            </CardHeader>
            <CardContent>
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
              <Feedback error={request.error} />
              <Button type="submit" disabled={request.isPending || waiting}>
                {request.isPending ? "Sending…" : "Send reset link"}
              </Button>
            </CardContent>
          </CardBody>
          <CardFooter>
            <LoginLink redirect={redirect} />
          </CardFooter>
        </form.Frame>
      </form.AppForm>
    </AuthLayout>
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
  const reset = useMutation({
    mutationFn: async (password: string) => {
      if (!token) {
        throw new AuthRequestError({ code: "INVALID_TOKEN" });
      }
      await submitRecovery((options) =>
        auth.resetPassword({ newPassword: password, token }, options)
      );
    },
  });
  const { waiting } = useAuthRetry(reset.error);
  const form = useAppForm({
    defaultValues: { confirmation: "", password: "" },
    listeners: {
      onChange: () => {
        if (!waiting) {
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
    (reset.error instanceof AuthRequestError &&
      ["INVALID_TOKEN", "USER_NOT_FOUND"].includes(reset.error.code ?? ""))
  ) {
    return (
      <RecoveryCard
        key="invalid"
        title="This reset link is no longer valid"
        description="Request a new link to reset your password."
        footer={<LoginLink redirect={redirect} />}
      >
        <Button
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
    <AuthLayout>
      <form.AppForm>
        <form.Frame pending={reset.isPending}>
          <CardBody>
            <CardHeader>
              <form.Heading
                errorTitle="Choose a new password"
                rejected={reset.isError}
              >
                Choose a new password
              </form.Heading>
            </CardHeader>
            <CardContent>
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
              <Feedback error={reset.error} />
              <Button type="submit" disabled={reset.isPending || waiting}>
                {reset.isPending ? "Saving…" : "Save new password"}
              </Button>
            </CardContent>
          </CardBody>
          <CardFooter>
            <LoginLink redirect={redirect} />
          </CardFooter>
        </form.Frame>
      </form.AppForm>
    </AuthLayout>
  );
};
