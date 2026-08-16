import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn.js";

export const Alert = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("alert", className)} role="alert" {...props} />
);
