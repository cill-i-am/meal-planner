import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export const Alert = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx("alert", className)} role="alert" {...props} />
);
