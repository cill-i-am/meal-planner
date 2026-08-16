import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn.js";

export const Separator = ({
  className,
  ...props
}: HTMLAttributes<HTMLHRElement>) => (
  <hr className={cn("separator", className)} {...props} />
);
