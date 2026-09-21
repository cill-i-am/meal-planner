import { useIsMutating, useMutation } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useAppForm } from "../../components/forms/form.js";
import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  CardBody,
  CardDescription,
} from "../../components/ui/card.js";
import { FieldGroup } from "../../components/ui/field.js";
import type { AuthenticationInput } from "./auth-client.js";
import { useAuthClient, authenticate } from "./auth-client.js";
import { AuthRequestError, authFeedback } from "./auth-errors.js";
import {
  parseSignIn,
  parseSignUp,
  signInValidator,
  signUpValidator,
} from "./auth-input.js";
import { AuthLayout } from "./auth-layout.js";

const useAuthRetry = (error: Error | null) => {
  const retryAt = error instanceof AuthRequestError ? error.retryAt : undefined;
  const [retryReady, setRetryReady] = useState(false);
  useEffect(() => {
    setRetryReady(false);
    if (retryAt === undefined) {
      return;
    }
    const timeout = window.setTimeout(
      () => setRetryReady(true),
      Math.max(0, retryAt - Date.now())
    );
    return () => window.clearTimeout(timeout);
  }, [retryAt]);
  const waiting = retryAt !== undefined && !retryReady && retryAt > Date.now();
  return { retryAt, retryReady, waiting };
};

const useAuthentication = (redirect: string) => {
  const navigate = useNavigate();
  const authClient = useAuthClient();
  const session = authClient.useSession();
  const organizations = authClient.useListOrganizations();
  const activeOrganization = authClient.useActiveOrganization();
  const mutation = useMutation({
    mutationFn: async (input: AuthenticationInput) => {
      await authenticate(authClient, input);
      await Promise.all([
        session.refetch(),
        organizations.refetch(),
        activeOrganization.refetch(),
      ]);
      await navigate({ href: redirect, replace: true });
    },
    mutationKey: ["authenticate"],
  });
  const feedback = authFeedback(
    mutation.error,
    mutation.variables?.kind === "signup"
  );
  const { retryAt, retryReady, waiting } = useAuthRetry(mutation.error);
  const blocked = mutation.isPending || waiting || feedback?.stop === true;
  return {
    blocked,
    clearError: () => {
      if (!waiting && !feedback?.stop) {
        mutation.reset();
      }
    },
    feedback,
    message:
      retryReady && retryAt !== undefined
        ? "You can try again now."
        : feedback?.message,
    pending: mutation.isPending,
    submit: (input: AuthenticationInput) => {
      if (!blocked) {
        mutation.mutate(input);
      }
    },
  };
};

const LoginForm = ({ redirect }: { readonly redirect: string }) => {
  const auth = useAuthentication(redirect);
  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    listeners: { onChange: auth.clearError },
    onSubmit: ({ value }) =>
      auth.submit({ input: parseSignIn(value), kind: "login" }),
    validators: { onChange: signInValidator, onSubmit: signInValidator },
  });
  return (
    <form.AppForm>
      <form.Frame pending={auth.pending}>
        <CardBody>
          <CardHeader>
            <form.Heading errorTitle="Log in" rejected={auth.feedback !== null}>
              Welcome back
            </form.Heading>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <form.AppField name="email">
                {(field) => (
                  <field.TextField
                    id="login-email"
                    label="Email"
                    type="email"
                    autoComplete="email"
                    disabled={auth.pending}
                    serverError={
                      auth.feedback?.field === "email"
                        ? auth.feedback.message
                        : undefined
                    }
                  />
                )}
              </form.AppField>
              <form.AppField name="password">
                {(field) => (
                  <field.PasswordField
                    action={
                      <Button
                        variant="link"
                        className="rounded-lg px-0"
                        disabled={auth.pending}
                        render={
                          <Link
                            to="/forgot-password"
                            search={{ redirect }}
                            disabled={auth.pending}
                          />
                        }
                        nativeButton={false}
                        role="link"
                      >
                        Forgot password?
                      </Button>
                    }
                    id="login-password"
                    label="Password"
                    autoComplete="current-password"
                    disabled={auth.pending}
                    serverError={
                      auth.feedback?.field === "password"
                        ? auth.feedback.message
                        : undefined
                    }
                  />
                )}
              </form.AppField>
            </FieldGroup>
            {auth.feedback && !auth.feedback.field && (
              <Alert variant="destructive">
                <AlertDescription>{auth.message}</AlertDescription>
              </Alert>
            )}

            <Button className="w-full" type="submit" disabled={auth.blocked}>
              {auth.pending ? "Logging in…" : "Log in"}
            </Button>
          </CardContent>
        </CardBody>
        <CardFooter>
          <span>New here?</span>
          <Button
            variant="link"
            className="px-0"
            disabled={auth.pending}
            render={
              <Link
                to="/signup"
                search={{ redirect }}
                disabled={auth.pending}
              />
            }
            nativeButton={false}
            role="link"
          >
            Create an account
          </Button>
        </CardFooter>
      </form.Frame>
    </form.AppForm>
  );
};

const SignupForm = ({ redirect }: { readonly redirect: string }) => {
  const auth = useAuthentication(redirect);
  const form = useAppForm({
    defaultValues: { email: "", name: "", password: "" },
    listeners: { onChange: auth.clearError },
    onSubmit: ({ value }) =>
      auth.submit({ input: parseSignUp(value), kind: "signup" }),
    validators: { onChange: signUpValidator, onSubmit: signUpValidator },
  });
  return (
    <form.AppForm>
      <form.Frame pending={auth.pending}>
        <CardBody>
          <CardHeader>
            <form.Heading
              errorTitle="Create your account"
              rejected={auth.feedback !== null}
            >
              Create your account
            </form.Heading>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    id="signup-name"
                    label="Your name"
                    autoComplete="name"
                    disabled={auth.pending}
                  />
                )}
              </form.AppField>
              <form.AppField name="email">
                {(field) => (
                  <field.TextField
                    id="signup-email"
                    label="Email"
                    type="email"
                    autoComplete="email"
                    disabled={auth.pending}
                    serverError={
                      auth.feedback?.field === "email"
                        ? auth.feedback.message
                        : undefined
                    }
                  />
                )}
              </form.AppField>
              <form.AppField name="password">
                {(field) => (
                  <field.PasswordField
                    id="signup-password"
                    label="Password"
                    autoComplete="new-password"
                    description="At least 8 characters."
                    disabled={auth.pending}
                    serverError={
                      auth.feedback?.field === "password"
                        ? auth.feedback.message
                        : undefined
                    }
                  />
                )}
              </form.AppField>
            </FieldGroup>
            {auth.feedback && !auth.feedback.field && (
              <Alert variant="destructive">
                <AlertDescription>{auth.message}</AlertDescription>
              </Alert>
            )}

            <Button className="w-full" type="submit" disabled={auth.blocked}>
              {auth.pending ? "Creating account…" : "Create account"}
            </Button>
          </CardContent>
        </CardBody>
        <CardFooter>
          <span>Already have an account?</span>
          <Button
            variant="link"
            className="px-0"
            disabled={auth.pending}
            render={
              <Link to="/login" search={{ redirect }} disabled={auth.pending} />
            }
            nativeButton={false}
            role="link"
          >
            Log in
          </Button>
        </CardFooter>
      </form.Frame>
    </form.AppForm>
  );
};

const AnonymousOnly = ({
  children,
  redirect,
}: {
  readonly children: ReactNode;
  readonly redirect: string;
}) => {
  const authClient = useAuthClient();
  const session = authClient.useSession();
  const pending = useIsMutating({ mutationKey: ["authenticate"] });
  return session.data !== null && pending === 0 ? (
    <Navigate to={redirect} replace />
  ) : (
    children
  );
};

export const LoginPage = ({ redirect }: { readonly redirect: string }) => (
  <AnonymousOnly redirect={redirect}>
    <AuthLayout>
      <LoginForm redirect={redirect} />
    </AuthLayout>
  </AnonymousOnly>
);

export const SignupPage = ({ redirect }: { readonly redirect: string }) => (
  <AnonymousOnly redirect={redirect}>
    <AuthLayout>
      <SignupForm redirect={redirect} />
    </AuthLayout>
  </AnonymousOnly>
);

export const RecoveryUnavailablePage = ({
  redirect,
}: {
  readonly redirect: string;
}) => (
  <AuthLayout>
    <Card className="w-full max-w-[30rem]" aria-labelledby="auth-title">
      <CardBody>
        <CardHeader>
          <CardTitle>
            <h1
              id="auth-title"
              tabIndex={-1}
              className="text-task-mobile/8 md:text-task-desktop/9 font-semibold tracking-tight focus:outline-none"
            >
              Password reset unavailable
            </h1>
          </CardTitle>
          <CardDescription>
            You can’t reset your password right now. Please try again later.
          </CardDescription>
        </CardHeader>
      </CardBody>
      <CardFooter>
        <Button
          variant="link"
          className="px-0"
          render={<Link to="/login" search={{ redirect }} />}
          nativeButton={false}
          role="link"
        >
          Back to log in
        </Button>
      </CardFooter>
    </Card>
  </AuthLayout>
);
