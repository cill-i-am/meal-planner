"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { cn } from "../../lib/utils.js";

const Collapsible = ({
  className,
  variant = "default",
  ...props
}: CollapsiblePrimitive.Root.Props & {
  variant?: "default" | "invite";
}) => (
  <CollapsiblePrimitive.Root
    className={cn(
      variant === "invite" &&
        "border-input bg-background data-open:border-primary has-[:focus-visible]:border-ring has-[:focus-visible]:ring-ring/25 overflow-hidden rounded-lg border transition-colors has-[:focus-visible]:ring-3",
      className
    )}
    {...props}
  />
);

const CollapsibleContent = ({
  className,
  variant = "default",
  ...props
}: CollapsiblePrimitive.Panel.Props & {
  variant?: "default" | "adult";
}) => (
  <CollapsiblePrimitive.Panel
    data-slot="collapsible-content"
    className={cn(
      "[height:var(--collapsible-panel-height)] overflow-hidden data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-safe:transition-[height,opacity] motion-safe:duration-[220ms] motion-safe:ease-out data-ending-style:motion-safe:duration-[160ms] motion-reduce:transition-none",
      variant === "adult" &&
        "data-ending-style:translate-y-1 data-open:overflow-visible data-starting-style:translate-y-1 data-starting-style:overflow-hidden motion-safe:transition-[height,opacity,translate]",
      className
    )}
    {...props}
  />
);

export { Collapsible, CollapsibleContent };
