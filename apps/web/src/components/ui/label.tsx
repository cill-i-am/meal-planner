import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

export const Label = ({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) => (
  <LabelPrimitive.Root className={cn("label", className)} {...props} />
);
