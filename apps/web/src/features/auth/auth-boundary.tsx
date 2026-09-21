import type { SetupProgress } from "@meal-planner/household-api";
import { Navigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.js";

export interface HouseholdSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface AuthBoundaryActions {
  readonly retry: () => Promise<void>;
  readonly signOut: () => Promise<void>;
}

export type AuthBoundaryState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "anonymous" }
  | {
      readonly activeHousehold: HouseholdSummary | null;
      readonly households: readonly HouseholdSummary[];
      readonly kind: "authenticated";
      readonly user: {
        readonly email: string;
        readonly name: string;
        readonly setupProgress?: SetupProgress;
      };
    };

const LoginRedirect = () => {
  const router = useRouter();
  useEffect(() => {
    void router.navigate({
      replace: true,
      search: { redirect: router.state.location.href },
      to: "/login",
    });
  }, [router]);
  return null;
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
    return <LoginRedirect />;
  }
  if (
    state.activeHousehold === null ||
    (state.user.setupProgress &&
      state.user.setupProgress.checkpoint.stage !== "complete")
  ) {
    return <Navigate to="/setup" replace />;
  }
  return children(state.activeHousehold, actions.signOut);
};
