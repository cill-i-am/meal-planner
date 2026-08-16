import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn.js";

export const Badge = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("badge", className)} {...props} />
);
