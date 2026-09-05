import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export const Skeleton = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div aria-hidden="true" className={clsx("skeleton", className)} {...props} />
);
