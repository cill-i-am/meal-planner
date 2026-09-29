import {
  useIsMutating,
  useMutation,
  useQueryClient,
  useQuery,
} from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useAppForm } from "../../components/forms/form.js";
import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { FieldGroup } from "../../components/ui/field.js";
import { PendingButton } from "../../components/ui/pending-button.js";
import { accountKey, accountQuery } from "./account-query.js";
import type { AuthenticationInput } from "./auth-client.js";
import { authenticationMutationOptions, useAuthClient } from "./auth-client.js";
import { authFeedback } from "./auth-errors.js";
import {
  parseSignIn,
  parseSignUp,
  signInValidator,
  signUpValidator,
} from "./auth-input.js";
import { EntryFormSurface, EntryLayout } from "./entry-layout.js";
import { useAuthRetry } from "./use-auth-retry.js";

const useAuthentication = (redirect: string) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const authClient = useAuthClient();
  const mutation = useMutation({
    ...authenticationMutationOptions(authClient),
    // An anonymous read started before the credential write must not publish
    // its old result after Better Auth has created the new session.
    onMutate: () =>
      queryClient.cancelQueries({ exact: true, queryKey: accountKey }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountKey });
      await navigate({ href: redirect, replace: true });
    },
  });
  // TanStack also stores errors thrown by onSuccess (refresh or navigation),
  // which are not wrapped by effect-query.
  let error: Error | null = mutation.error;
  if (
    mutation.error?._tag === "EffectQueryFailure" ||
    mutation.error?._tag === "EffectQueryDefect"
  ) {
    const queryError = mutation.error;
    error = mutation.error.match<Error>({
      AuthRequestError: (failure) => failure,
      OrElse: () => queryError,
    });
  }
  const feedback = authFeedback(error, mutation.variables?.kind === "signup");
  const { retryAt, retryReady, waiting } = useAuthRetry(error);
  const blocked = mutation.isPending || waiting || feedback?.stop === true;
  return {
    blocked,
    clearError: () => {
      if (mutation.isError && !waiting && !feedback?.stop) {
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
    <EntryLayout
      headerAction={
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground hidden sm:inline">
            New here?
          </span>
          <Button
            variant="link"
            className="h-11 px-0 text-sm"
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
        </div>
      }
    >
      <EntryFormSurface className="mx-auto pt-26 md:pt-34">
        <form.AppForm>
          <form.Frame
            pending={auth.pending}
            className="max-w-none"
            variant="plain"
          >
            <div className="flex flex-col">
              <div className="flex flex-col gap-5 pb-15 md:pb-8">
                <form.Heading
                  errorTitle="Log in"
                  rejected={auth.feedback !== null}
                  variant="plain"
                  className="font-display text-entry-mobile tracking-entry md:text-entry-desktop font-normal motion-safe:[view-transition-name:auth-heading]"
                >
                  <span className="md:hidden">
                    Welcome <br />
                    back.
                  </span>
                  <span className="hidden md:inline">Welcome back.</span>
                </form.Heading>
                <p className="text-muted-foreground text-sm leading-5.75">
                  Let’s pick up where you left off.
                </p>
              </div>
              <div className="flex flex-col">
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
                            className="h-11 px-0 text-sm"
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
                  <Alert variant="destructive" className="mt-6">
                    <AlertDescription>{auth.message}</AlertDescription>
                  </Alert>
                )}

                <PendingButton
                  className="mt-8 w-full"
                  type="submit"
                  disabled={auth.blocked}
                  pending={auth.pending}
                  pendingLabel="Logging in…"
                >
                  Log in
                </PendingButton>
              </div>
            </div>
          </form.Frame>
        </form.AppForm>
      </EntryFormSurface>
    </EntryLayout>
  );
};

const SignupStory = () => (
  <div className="min-w-0">
    <div className="flex items-center justify-between gap-5 lg:block">
      <div className="font-display text-signup-promise-mobile tracking-entry lg:tracking-promise xl:text-signup-promise-desktop lg:text-6xl">
        <span className="hidden lg:inline">
          Good food.
          <br />
          Different people.
          <br />
          One family.
        </span>
        <span className="lg:hidden">
          Good food.
          <br />
          Your people.
        </span>
      </div>
      <img
        src="/images/journey/pesto-pasta.avif"
        alt=""
        aria-hidden="true"
        className="size-[88px] shrink-0 rotate-8 rounded-full object-cover lg:hidden"
      />
    </div>
    <p className="text-muted-foreground mt-6 hidden text-base leading-6.25 lg:block">
      Breakfast to bedtime,
      <br />a week that works for your people.
    </p>
    <div className="relative mt-16 ml-16 hidden h-[287px] lg:block">
      <img
        src="/images/journey/pesto-pasta.avif"
        alt=""
        aria-hidden="true"
        className="size-[267px] -rotate-8 rounded-full object-cover"
      />
      <div className="font-display text-entry-annotation absolute top-[106px] left-[231px] hidden rotate-4 rounded-2xl bg-(--glow-lilac) px-5.75 py-4.5 xl:block">
        Same dinner.
        <br />
        Their own little edits.
      </div>
    </div>
  </div>
);

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
    <EntryLayout
      headerAction={
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground hidden sm:inline">
            Already have an account?
          </span>
          <Button
            variant="link"
            className="h-11 px-0 text-sm"
            disabled={auth.pending}
            render={
              <Link to="/login" search={{ redirect }} disabled={auth.pending} />
            }
            nativeButton={false}
            role="link"
          >
            Log in
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 pt-16 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:gap-12 xl:mx-auto xl:max-w-[1263px] xl:grid-cols-[minmax(0,1fr)_1px_400px] xl:gap-19">
        <SignupStory />
        <div
          aria-hidden="true"
          className="bg-border hidden h-[523px] w-px xl:block"
        />
        <EntryFormSurface className="lg:pt-10">
          <form.AppForm>
            <form.Frame
              pending={auth.pending}
              className="max-w-none"
              variant="plain"
            >
              <div className="flex flex-col">
                <div className="flex flex-col gap-5 pb-7 max-lg:pb-8">
                  <form.Heading
                    errorTitle="Create your account"
                    rejected={auth.feedback !== null}
                    variant="plain"
                    className="lg:font-display lg:tracking-entry sr-only motion-safe:[view-transition-name:auth-heading] lg:not-sr-only lg:text-5xl/12.5 lg:font-normal"
                  >
                    Start with you.
                  </form.Heading>
                  <p className="text-muted-foreground text-sm leading-5.75">
                    Create your account.
                    <br />
                    We’ll meet your family next.
                  </p>
                </div>
                <div className="flex flex-col">
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
                    <Alert variant="destructive" className="mt-5">
                      <AlertDescription>{auth.message}</AlertDescription>
                    </Alert>
                  )}

                  <PendingButton
                    className="mt-10 w-full"
                    type="submit"
                    disabled={auth.blocked}
                    pending={auth.pending}
                    pendingLabel="Creating account…"
                  >
                    Create account
                  </PendingButton>
                </div>
              </div>
            </form.Frame>
          </form.AppForm>
        </EntryFormSurface>
      </div>
    </EntryLayout>
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
  const session = useQuery(accountQuery(authClient));
  const pending = useIsMutating({ mutationKey: ["authenticate"] });
  return session.data && pending === 0 ? (
    <Navigate to={redirect} replace />
  ) : (
    children
  );
};

export const LoginPage = ({ redirect }: { readonly redirect: string }) => (
  <AnonymousOnly redirect={redirect}>
    <LoginForm redirect={redirect} />
  </AnonymousOnly>
);

export const SignupPage = ({ redirect }: { readonly redirect: string }) => (
  <AnonymousOnly redirect={redirect}>
    <SignupForm redirect={redirect} />
  </AnonymousOnly>
);
