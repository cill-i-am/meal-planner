"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { useReducedMotion } from "motion/react";

import { cn } from "../../lib/utils.js";
import { BaseMotionElement } from "./base-motion-element.js";

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
  render,
  ...props
}: CollapsiblePrimitive.Panel.Props & {
  variant?: "default" | "adult";
}) => {
  const reducedMotion = useReducedMotion();
  const openingDuration = reducedMotion ? 0 : 0.22;
  const closingDuration = reducedMotion ? 0 : 0.16;

  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      keepMounted
      className={(state) =>
        cn(
          "[height:var(--collapsible-panel-height)] overflow-hidden data-ending-style:h-0 data-starting-style:h-0 motion-safe:transition-[height] motion-safe:duration-[220ms] motion-safe:ease-out data-ending-style:motion-safe:duration-[160ms]",
          state.open && state.transitionStatus === "idle" && "overflow-visible",
          className
        )
      }
      {...props}
      render={
        render ??
        ((renderProps, state) => (
          <BaseMotionElement
            baseProps={renderProps}
            initial={false}
            animate={{
              opacity: state.open ? 1 : 0,
              y: variant === "adult" && !state.open && !reducedMotion ? 4 : 0,
            }}
            transition={{
              duration: state.open ? openingDuration : closingDuration,
              ease: "easeOut",
            }}
          />
        ))
      }
    />
  );
};

export { Collapsible, CollapsibleContent };
