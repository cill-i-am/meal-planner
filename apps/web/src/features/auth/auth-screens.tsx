import { useForm } from "@tanstack/react-form";
import { useIsMutating, useMutation } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import { useAuthClient, authenticate } from "./auth-client.js";
import { AuthRequestError, authFeedback } from "./auth-errors.js";
import {
  parseSignIn,
  parseSignUp,
  signInValidator,
  signUpValidator,
} from "./auth-input.js";

const PasswordInput = (props: ComponentProps<typeof Input>) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-password">
      <Input {...props} type={visible ? "text" : "password"} />
      <Button
        variant="ghost"
        data-auth-action="show"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={props.id}
        onClick={() => setVisible(!visible)}
        disabled={props.disabled}
      >
        {visible ? "Hide" : "Show"}
      </Button>
    </div>
  );
};

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

const LoginHeading = ({ invalid }: { readonly invalid: boolean }) =>
  invalid ? "Log in" : "Welcome back";

const SignupHeading = ({ invalid }: { readonly invalid: boolean }) =>
  invalid ? (
    <>Create your account</>
  ) : (
    <>
      <span>Less planning.</span>
      <span>More living.</span>
    </>
  );

export const AccountForm = ({
  signup,
  redirect,
}: {
  readonly signup: boolean;
  readonly redirect: string;
}) => {
  const navigate = useNavigate();
  const authClient = useAuthClient();
  const session = authClient.useSession();
  const organizations = authClient.useListOrganizations();
  const activeOrganization = authClient.useActiveOrganization();
  const formElement = useRef<HTMLFormElement>(null);
  const mutation = useMutation({
    mutationFn: async (values: {
      email: string;
      name: string;
      password: string;
    }) => {
      const input = signup
        ? parseSignUp(values)
        : { ...parseSignIn(values), name: "" };
      await authenticate(authClient, signup ? "signup" : "login", input);
      await Promise.all([
        session.refetch(),
        organizations.refetch(),
        activeOrganization.refetch(),
      ]);
      await navigate({ href: redirect, replace: true });
    },
    mutationKey: ["authenticate"],
  });
  const feedback = authFeedback(mutation.error, signup);
  const { retryAt, retryReady, waiting } = useAuthRetry(mutation.error);
  const validator = signup ? signUpValidator : signInValidator;
  const form = useForm({
    defaultValues: { email: "", name: "", password: "" },
    onSubmit: ({ value }) => {
      if (!mutation.isPending && !waiting && !feedback?.stop) {
        mutation.mutate(value);
      }
    },
    onSubmitInvalid: () => {
      requestAnimationFrame(() =>
        formElement.current
          ?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')
          ?.focus()
      );
    },
    validators: { onChange: validator, onSubmit: validator },
  });
  const prefix = signup ? "signup" : "login";
  const passwordAutocomplete = signup ? "new-password" : "current-password";
  const submitLabel = signup ? "Create account" : "Log in";
  const pendingLabel = signup ? "Creating account…" : "Logging in…";
  return (
    <form
      ref={formElement}
      className="auth-content"
      noValidate
      aria-labelledby="auth-title"
      aria-busy={mutation.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe
        selector={(state) =>
          Object.values(state.fieldMeta).some(
            (meta) =>
              (meta.isBlurred || state.submissionAttempts > 0) &&
              meta.errors.length > 0
          )
        }
      >
        {(invalid) => (
          <h1
            tabIndex={-1}
            id="auth-title"
            className={
              signup && !invalid && feedback === null
                ? "auth-welcome"
                : "auth-heading"
            }
          >
            {signup ? (
              <SignupHeading invalid={invalid || feedback !== null} />
            ) : (
              <LoginHeading invalid={invalid || feedback !== null} />
            )}
          </h1>
        )}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.submissionAttempts}>
        {(attempts) => (
          <>
            {(
              [
                ...(signup ? ["name" as const] : []),
                "email",
                "password",
              ] as const
            ).map((name) => (
              <form.Field key={name} name={name}>
                {(field) => {
                  const fieldError =
                    field.state.meta.isBlurred || attempts > 0
                      ? field.state.meta.errors[0]?.message
                      : undefined;
                  const serverError =
                    feedback?.field === name ? feedback.message : undefined;
                  const error = fieldError ?? serverError;
                  const id = `${prefix}-${name}`;
                  const helper =
                    signup && name === "password" && error === undefined;
                  const props = {
                    "aria-describedby":
                      [error && `${id}-error`, helper && `${id}-help`]
                        .filter(Boolean)
                        .join(" ") || undefined,
                    "aria-invalid": error !== undefined,
                    autoComplete:
                      name === "password" ? passwordAutocomplete : name,
                    disabled: mutation.isPending,
                    id,
                    name,
                    onBlur: () => {
                      field.handleBlur();
                      void form.validate("change");
                    },
                    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                      field.handleChange(event.target.value);
                      if (!waiting && !feedback?.stop) {
                        mutation.reset();
                      }
                    },
                    required: true,
                    value: field.state.value,
                  };
                  return (
                    <Field data-invalid={error !== undefined}>
                      <FieldLabel htmlFor={id}>
                        {
                          {
                            email: "Email",
                            name: "Your name",
                            password: "Password",
                          }[name]
                        }
                      </FieldLabel>
                      {name === "password" ? (
                        <PasswordInput {...props} />
                      ) : (
                        <Input
                          {...props}
                          type={name === "email" ? "email" : "text"}
                        />
                      )}
                      {helper && (
                        <FieldDescription id={`${id}-help`}>
                          At least 8 characters.
                        </FieldDescription>
                      )}
                      <FieldError id={`${id}-error`}>{error}</FieldError>
                    </Field>
                  );
                }}
              </form.Field>
            ))}
          </>
        )}
      </form.Subscribe>
      <form.Subscribe
        selector={(state) => ({
          attempts: state.submissionAttempts,
          errors: state.errors,
        })}
      >
        {({ attempts, errors }) =>
          attempts > 0 && errors.length > 0 ? (
            <p role="alert" className="sr-only">
              Check the highlighted fields before continuing.
            </p>
          ) : null
        }
      </form.Subscribe>
      {feedback !== null && feedback.field === undefined && (
        <Alert data-auth-alert>
          {retryReady && retryAt !== undefined
            ? "You can try again now."
            : feedback.message}
        </Alert>
      )}
      {!signup && (
        <Button
          variant="link"
          data-auth-action="forgot"
          disabled={mutation.isPending}
          render={<Link to="/forgot-password" search={{ redirect }} />}
          nativeButton={false}
          role="link"
        >
          Forgot password?
        </Button>
      )}
      <Button
        type="submit"
        disabled={mutation.isPending || waiting || feedback?.stop === true}
      >
        {mutation.isPending ? pendingLabel : submitLabel}
      </Button>
      {!signup && (
        <Button
          variant="link"
          disabled={mutation.isPending}
          render={<Link to="/signup" search={{ redirect }} />}
          nativeButton={false}
          role="link"
        >
          Create an account
        </Button>
      )}
      {signup && feedback !== null && (
        <Button
          variant="link"
          disabled={mutation.isPending}
          render={<Link to="/login" search={{ redirect }} />}
          nativeButton={false}
          role="link"
        >
          Log in
        </Button>
      )}
    </form>
  );
};

export const AuthLayout = ({
  children,
  signup = false,
  redirect = "/",
}: {
  readonly children: ReactNode;
  readonly signup?: boolean;
  readonly redirect?: string;
}) => {
  const pending = useIsMutating({ mutationKey: ["authenticate"] }) > 0;
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    surface.current?.querySelector<HTMLElement>("h1")?.focus();
    const element = surface.current;
    if (element === null) {
      return;
    }
    let visible = true;
    const update = () => {
      element.dataset["paused"] = String(document.hidden || !visible);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <div className="auth-experience" ref={surface}>
      <header className="auth-header">
        <div className="auth-brand">
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24">
            <circle cx="6" cy="6" r="5" />
            <circle cx="18" cy="6" r="5" />
            <circle cx="6" cy="18" r="5" />
            <circle cx="18" cy="18" r="5" />
          </svg>
          <span>Meal Planner</span>
        </div>
        {signup && (
          <Link
            disabled={pending}
            className="auth-header-login auth-link"
            to="/login"
            search={{ redirect }}
          >
            <span>Already have an account? </span>Log in
          </Link>
        )}
      </header>
      {signup && (
        <nav aria-label="Setup progress" className="auth-progress">
          <ol>
            <li aria-current="step">
              <span>1</span>Account
            </li>
            <li>Family</li>
            <li>People</li>
          </ol>
        </nav>
      )}
      <main className="auth-main">
        <div aria-hidden="true" className="auth-glow" />
        {children}
      </main>
    </div>
  );
};

export const AccountPage = ({
  signup,
  redirect,
}: {
  readonly signup: boolean;
  readonly redirect: string;
}) => {
  const authClient = useAuthClient();
  const session = authClient.useSession();
  const pending = useIsMutating({ mutationKey: ["authenticate"] });
  if (session.data !== null && pending === 0) {
    return <Navigate to={redirect} replace />;
  }
  return (
    <AuthLayout signup={signup} redirect={redirect}>
      <AccountForm signup={signup} redirect={redirect} />
    </AuthLayout>
  );
};

export const RecoveryUnavailablePage = ({
  redirect,
}: {
  readonly redirect: string;
}) => (
  <AuthLayout>
    <section className="auth-content" aria-labelledby="auth-title">
      <div className="auth-recovery-heading">
        <h1 className="auth-heading" id="auth-title" tabIndex={-1}>
          Password reset unavailable
        </h1>
        <p>You can’t reset your password right now. Please try again later.</p>
      </div>
      <Button
        render={<Link to="/login" search={{ redirect }} />}
        nativeButton={false}
        role="link"
      >
        Back to log in
      </Button>
    </section>
  </AuthLayout>
);
