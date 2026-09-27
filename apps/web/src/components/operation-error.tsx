import type { ReactNode } from "react";

import { Alert, AlertDescription } from "./ui/alert.js";

export const OperationError = ({
  children,
}: {
  readonly children: ReactNode;
}) => (
  <Alert variant="destructive">
    <AlertDescription>{children}</AlertDescription>
  </Alert>
);
