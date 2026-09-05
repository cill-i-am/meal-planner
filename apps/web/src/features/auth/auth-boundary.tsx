import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";

export interface HouseholdSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface AuthBoundaryActions {
  readonly createHousehold: (input: {
    readonly name: string;
    readonly slug: string;
  }) => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly selectHousehold: (organizationId: string) => Promise<void>;
  readonly signIn: (input: {
    readonly email: string;
    readonly password: string;
  }) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly signUp: (input: {
    readonly email: string;
    readonly name: string;
    readonly password: string;
  }) => Promise<void>;
}

export type AuthBoundaryState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "anonymous" }
  | {
      readonly activeHousehold: HouseholdSummary | null;
      readonly households: readonly HouseholdSummary[];
      readonly kind: "authenticated";
      readonly user: { readonly email: string; readonly name: string };
    };

export const householdSlug = (name: string, suffix: string): string => {
  const stem = name
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "")
    .slice(0, 40);
  return `${stem || "household"}-${suffix.toLowerCase()}`;
};

const MutationError = ({ error }: { readonly error: Error | null }) =>
  error === null ? null : (
    <Alert>
      <p>{error.message}</p>
    </Alert>
  );

const SignInForm = ({
  action,
}: {
  readonly action: AuthBoundaryActions["signIn"];
}) => {
  const mutation = useMutation({ mutationFn: action });
  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: ({ value }) => mutation.mutate(value),
  });
  return (
    <form
      className="auth-form field-stack"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <h2>Log in</h2>
      <form.Field name="email">
        {(field) => (
          <div className="field-stack">
            <Label htmlFor="login-email">Email</Label>
            <Input
              autoComplete="email"
              id="login-email"
              onChange={(event) => field.handleChange(event.target.value)}
              required
              type="email"
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <div className="field-stack">
            <Label htmlFor="login-password">Password</Label>
            <Input
              autoComplete="current-password"
              id="login-password"
              minLength={8}
              onChange={(event) => field.handleChange(event.target.value)}
              required
              type="password"
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>
      <MutationError error={mutation.error} />
      <Button disabled={mutation.isPending} type="submit">
        Log in
      </Button>
    </form>
  );
};

const SignUpForm = ({
  action,
}: {
  readonly action: AuthBoundaryActions["signUp"];
}) => {
  const mutation = useMutation({ mutationFn: action });
  const form = useForm({
    defaultValues: { email: "", name: "", password: "" },
    onSubmit: ({ value }) => mutation.mutate(value),
  });
  return (
    <form
      className="auth-form field-stack"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <h2>Create account</h2>
      <form.Field name="name">
        {(field) => (
          <div className="field-stack">
            <Label htmlFor="signup-name">Name</Label>
            <Input
              autoComplete="name"
              id="signup-name"
              onChange={(event) => field.handleChange(event.target.value)}
              required
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>
      <form.Field name="email">
        {(field) => (
          <div className="field-stack">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              autoComplete="email"
              id="signup-email"
              onChange={(event) => field.handleChange(event.target.value)}
              required
              type="email"
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <div className="field-stack">
            <Label htmlFor="signup-password">Password</Label>
            <Input
              autoComplete="new-password"
              id="signup-password"
              minLength={8}
              onChange={(event) => field.handleChange(event.target.value)}
              required
              type="password"
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>
      <MutationError error={mutation.error} />
      <Button disabled={mutation.isPending} type="submit">
        Create account
      </Button>
    </form>
  );
};

const HouseholdSetup = ({
  actions,
  households,
  userName,
}: {
  readonly actions: AuthBoundaryActions;
  readonly households: readonly HouseholdSummary[];
  readonly userName: string;
}) => {
  const createMutation = useMutation({ mutationFn: actions.createHousehold });
  const selectMutation = useMutation({ mutationFn: actions.selectHousehold });
  const form = useForm({
    defaultValues: { name: `${userName}'s household` },
    onSubmit: ({ value }) =>
      createMutation.mutate({
        name: value.name,
        slug: householdSlug(value.name, crypto.randomUUID().slice(0, 8)),
      }),
  });
  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="household-title">
        <p className="eyebrow">Household setup</p>
        <h1 id="household-title">Choose your household</h1>
        {households.length > 0 && (
          <div className="household-list">
            {households.map((household) => (
              <Button
                disabled={selectMutation.isPending}
                key={household.id}
                onClick={() => selectMutation.mutate(household.id)}
                type="button"
              >
                Continue to {household.name}
              </Button>
            ))}
          </div>
        )}
        <form
          className="auth-form field-stack"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <h2>Create a household</h2>
          <form.Field name="name">
            {(field) => (
              <div className="field-stack">
                <Label htmlFor="household-name">Household name</Label>
                <Input
                  id="household-name"
                  onChange={(event) => field.handleChange(event.target.value)}
                  required
                  value={field.state.value}
                />
              </div>
            )}
          </form.Field>
          <MutationError error={createMutation.error ?? selectMutation.error} />
          <Button disabled={createMutation.isPending} type="submit">
            Create household
          </Button>
        </form>
        <Button
          onClick={() => {
            void actions.signOut();
          }}
          type="button"
        >
          Log out
        </Button>
      </section>
    </main>
  );
};

export const AuthBoundary = ({
  actions,
  children,
  state,
}: {
  readonly actions: AuthBoundaryActions;
  readonly children: (
    household: HouseholdSummary,
    signOut: () => Promise<void>
  ) => ReactNode;
  readonly state: AuthBoundaryState;
}) => {
  if (state.kind === "loading") {
    return <main className="auth-shell">Loading your session…</main>;
  }
  if (state.kind === "error") {
    return (
      <main className="auth-shell">
        <section className="auth-panel" aria-labelledby="auth-error-title">
          <p className="eyebrow">Meal Planner</p>
          <h1 id="auth-error-title">Account temporarily unavailable</h1>
          <p className="lede">We couldn’t load your account right now.</p>
          <Button
            onClick={() => {
              void actions.retry();
            }}
            type="button"
          >
            Try again
          </Button>
        </section>
      </main>
    );
  }
  if (state.kind === "anonymous") {
    return (
      <main className="auth-shell">
        <section className="auth-panel" aria-labelledby="auth-title">
          <p className="eyebrow">Meal Planner</p>
          <h1 id="auth-title">Plan together at home</h1>
          <p className="lede">
            Log in or create an account with email and password.
          </p>
          <div className="auth-grid">
            <SignInForm action={actions.signIn} />
            <SignUpForm action={actions.signUp} />
          </div>
        </section>
      </main>
    );
  }
  if (state.activeHousehold === null) {
    return (
      <HouseholdSetup
        actions={actions}
        households={state.households}
        userName={state.user.name}
      />
    );
  }
  return children(state.activeHousehold, actions.signOut);
};
