import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn.js";

export const Skeleton = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div aria-hidden="true" className={cn("skeleton", className)} {...props} />
);
