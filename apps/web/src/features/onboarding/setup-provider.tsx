import type { ReactNode } from "react";

import { AccountProvider } from "../auth/index.js";
import { FamilyProvider } from "../family/index.js";

/** Only onboarding composes account and selected-family loading. Invitations need just the account. */
export const SetupProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => (
  <AccountProvider>
    <FamilyProvider>{children}</FamilyProvider>
  </AccountProvider>
);
