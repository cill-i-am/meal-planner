"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils.js";
import { toggleVariants } from "./toggle.js";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }
>({
  orientation: "horizontal",
  size: "default",
  spacing: 2,
  variant: "default",
});

const ToggleGroup = ({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }) => (
  <ToggleGroupPrimitive
    data-slot="toggle-group"
    data-variant={variant}
    data-size={size}
    data-spacing={spacing}
    data-orientation={orientation}
    style={{ "--gap": spacing } as React.CSSProperties}
    className={cn(
      "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-vertical:flex-col data-vertical:items-stretch data-[size=sm]:rounded-[min(var(--radius-md),10px)]",
      variant === "segment" &&
        "bg-muted inset-shadow-[0_2px_4px_--theme(--color-foreground/12%),0_-1px_0_var(--background)] aria-invalid:ring-destructive/20 aria-invalid:border-destructive h-13 w-full gap-1 rounded-xl border border-transparent p-1 aria-invalid:ring-3 aria-invalid:inset-shadow-none data-disabled:inset-shadow-none",
      className
    )}
    {...props}
  >
    <ToggleGroupContext.Provider
      value={{ orientation, size, spacing, variant }}
    >
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive>
);

const ToggleGroupItem = ({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) => {
  const context = React.useContext(ToggleGroupContext);

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        context.variant === "segment" && "min-w-0 flex-1",
        toggleVariants({
          size: context.size || size,
          variant: context.variant || variant,
        }),
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
};

export { ToggleGroup, ToggleGroupItem };
