"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import { LayoutGroup, m } from "motion/react";
import * as React from "react";

import { cn } from "../../lib/utils.js";
import { toggleVariants } from "./toggle.js";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
    selectedValue: string | undefined;
  }
>({
  orientation: "horizontal",
  selectedValue: undefined,
  size: "default",
  spacing: 2,
  variant: "default",
});

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
      {context.variant === "segment" ? (
        <>
          {context.selectedValue === props.value && (
            <m.span
              aria-hidden="true"
              data-slot="toggle-group-indicator"
              layoutId="segment-indicator"
              initial={false}
              transition={{
                layout: { duration: 0.22, ease: "easeOut", type: "tween" },
              }}
              className="border-primary bg-primary to-primary shadow-foreground/12 inset-shadow-[0_1px_--theme(--color-primary-foreground/25%)] pointer-events-none absolute -inset-px z-0 rounded-md border bg-linear-to-b/oklch from-[color-mix(in_oklch,var(--primary),var(--primary-foreground)_10%)] shadow-[0_1px_2px] group-has-[[aria-pressed=true]:active]/toggle-group:shadow-none group-has-[[aria-pressed=true]:active]/toggle-group:inset-shadow-none group-has-[[aria-pressed=true]:focus-visible]/toggle-group:shadow-none group-has-[[aria-pressed=true]:focus-visible]/toggle-group:inset-shadow-none group-data-disabled/toggle-group:shadow-none group-data-disabled/toggle-group:inset-shadow-none"
            />
          )}
          <span className="relative z-10">{children}</span>
        </>
      ) : (
        children
      )}
    </TogglePrimitive>
  );
};

type ToggleGroupProps = Omit<
  ToggleGroupPrimitive.Props,
  "multiple" | "orientation"
> &
  Pick<VariantProps<typeof toggleVariants>, "size"> & {
    spacing?: number;
  } & (
    | {
        variant: "segment";
        multiple?: false;
        orientation?: "horizontal";
      }
    | {
        variant?: Exclude<
          VariantProps<typeof toggleVariants>["variant"],
          "segment"
        >;
        multiple?: boolean;
        orientation?: "horizontal" | "vertical";
      }
  );

const ToggleGroup = ({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  value,
  defaultValue,
  onValueChange,
  ...props
}: ToggleGroupProps) => {
  const [defaultSegmentValue, setDefaultSegmentValue] = React.useState(
    defaultValue ?? []
  );
  const layoutGroupId = React.useId();
  const segmentValue = value ?? defaultSegmentValue;

  return (
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
          "bg-muted inset-shadow-[0_2px_4px_--theme(--color-foreground/12%),0_-1px_0_var(--background)] aria-invalid:ring-destructive/20 aria-invalid:border-destructive relative isolate h-13 w-full gap-1 rounded-xl border border-transparent p-1 aria-invalid:ring-3 aria-invalid:inset-shadow-none data-disabled:inset-shadow-none",
        className
      )}
      value={variant === "segment" ? segmentValue : value}
      defaultValue={variant === "segment" ? undefined : defaultValue}
      onValueChange={
        variant === "segment"
          ? (nextValue, eventDetails) => {
              onValueChange?.(nextValue, eventDetails);
              if (value === undefined && !eventDetails.isCanceled) {
                setDefaultSegmentValue(nextValue);
              }
            }
          : onValueChange
      }
      {...props}
    >
      <LayoutGroup id={layoutGroupId}>
        <ToggleGroupContext.Provider
          value={{
            orientation,
            selectedValue: segmentValue[0],
            size,
            spacing,
            variant,
          }}
        >
          {children}
        </ToggleGroupContext.Provider>
      </LayoutGroup>
    </ToggleGroupPrimitive>
  );
};

export { ToggleGroup, ToggleGroupItem };
