import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AccountProvider } from "../auth/index.js";
import { FamilyProvider } from "../family/index.js";

/** Creation stays account-scoped until its reviewed roster is saved; selected-family screens remount on family changes. */
export const SetupProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <AccountProvider>
      {pathname === "/setup/family" ? (
        children
      ) : (
        <FamilyProvider>{children}</FamilyProvider>
      )}
    </AccountProvider>
  );
};
