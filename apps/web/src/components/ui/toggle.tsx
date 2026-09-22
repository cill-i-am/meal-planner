import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const toggleVariants = cva(
  "group/toggle hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 inline-flex items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default:
          "h-11 min-w-11 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default: "bg-transparent",
        outline: "border-input hover:bg-muted border bg-transparent",
        segment:
          "text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:to-primary aria-pressed:shadow-foreground/12 aria-pressed:inset-shadow-[0_1px_--theme(--color-primary-foreground/25%)] aria-pressed:hover:bg-primary aria-pressed:hover:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/30 rounded-md border border-transparent aria-pressed:bg-linear-to-b/oklch aria-pressed:from-[color-mix(in_oklch,var(--primary),var(--primary-foreground)_10%)] aria-pressed:shadow-[0_1px_2px] aria-pressed:focus-visible:shadow-none aria-pressed:focus-visible:inset-shadow-none aria-pressed:active:shadow-none aria-pressed:active:inset-shadow-none aria-pressed:disabled:shadow-none aria-pressed:disabled:inset-shadow-none",
      },
    },
  }
);

const Toggle = ({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) => (
  <TogglePrimitive
    data-slot="toggle"
    className={cn(toggleVariants({ className, size, variant }))}
    {...props}
  />
);

export { Toggle, toggleVariants };
