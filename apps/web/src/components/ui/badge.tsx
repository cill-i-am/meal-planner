import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export const Badge = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span className={clsx("badge", className)} {...props} />
);
