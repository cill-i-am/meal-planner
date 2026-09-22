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
  const segmentValue = value ?? defaultSegmentValue;
  const segmentItems = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<TogglePrimitive.Props> =>
      React.isValidElement<TogglePrimitive.Props>(child) &&
      child.props.value !== undefined
  );
  const selectedIndex = segmentItems.findIndex(
    (child) => child.props.value === segmentValue[0]
  );

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
      <ToggleGroupContext.Provider
        value={{ orientation, size, spacing, variant }}
      >
        {variant === "segment" && selectedIndex !== -1 && (
          <span
            aria-hidden="true"
            data-slot="toggle-group-indicator"
            className="border-primary bg-primary to-primary shadow-foreground/12 inset-shadow-[0_1px_--theme(--color-primary-foreground/25%)] pointer-events-none absolute inset-y-[3px] left-1 w-[calc((100%-0.5rem-(var(--segment-count)-1)*0.25rem)/var(--segment-count))] translate-x-[calc(var(--segment-index)*(100%+0.25rem))] rounded-md border bg-linear-to-b/oklch from-[color-mix(in_oklch,var(--primary),var(--primary-foreground)_10%)] shadow-[0_1px_2px] transition-transform duration-150 ease-out group-has-[[aria-pressed=true]:active]/toggle-group:shadow-none group-has-[[aria-pressed=true]:active]/toggle-group:inset-shadow-none group-has-[[aria-pressed=true]:focus-visible]/toggle-group:shadow-none group-has-[[aria-pressed=true]:focus-visible]/toggle-group:inset-shadow-none group-data-disabled/toggle-group:shadow-none group-data-disabled/toggle-group:inset-shadow-none motion-reduce:transition-none"
            style={
              {
                "--segment-count": segmentItems.length,
                "--segment-index": selectedIndex,
              } as React.CSSProperties
            }
          />
        )}
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
};

export { ToggleGroup, ToggleGroupItem };
