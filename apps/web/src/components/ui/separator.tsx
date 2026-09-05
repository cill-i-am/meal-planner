import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export const Separator = ({
  className,
  ...props
}: HTMLAttributes<HTMLHRElement>) => (
  <hr className={clsx("separator", className)} {...props} />
);
