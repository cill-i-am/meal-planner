import * as LabelPrimitive from "@radix-ui/react-label";
import { clsx } from "clsx";
import type { ComponentProps } from "react";

export const Label = ({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) => (
  <LabelPrimitive.Root className={clsx("label", className)} {...props} />
);
