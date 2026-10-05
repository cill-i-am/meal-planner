import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AccountProvider } from "../auth/index.js";
import { FamilyProvider } from "../family/index.js";

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
