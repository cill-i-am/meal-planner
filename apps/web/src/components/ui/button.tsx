import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/25 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-[var(--button-radius)] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-[var(--control-height)] gap-1.5 px-4",
        icon: "size-11",
        "icon-lg": "size-9",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:bg-primary-hover shadow-primary/24 shadow-xs not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] active:shadow-none active:inset-shadow-[0_1px_--theme(--color-black/8%)] disabled:shadow-none",
        destructive:
          "border-destructive bg-destructive hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 shadow-destructive/24 text-white shadow-xs not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] active:shadow-none active:inset-shadow-[0_1px_--theme(--color-black/8%)] disabled:shadow-none",
        "destructive-outline":
          "border-input bg-background text-destructive hover:bg-destructive/5 shadow-foreground/8 focus-visible:ring-destructive/20 shadow-xs active:shadow-none disabled:shadow-none",
        ghost:
          "text-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        link: "text-primary bg-transparent font-normal underline underline-offset-4 hover:decoration-2",
        outline:
          "border-input bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground shadow-foreground/8 shadow-xs active:shadow-none disabled:shadow-none",
        secondary:
          "border-border bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground shadow-foreground/8 shadow-xs not-disabled:inset-shadow-[0_1px_--theme(--color-white/60%)] hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:shadow-none active:inset-shadow-[0_1px_--theme(--color-black/8%)] disabled:shadow-none",
      },
    },
  }
);

const Button = ({
  className,
  variant = "default",
  size = "default",
  type = "button",
  static: isStatic = variant === "link",
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { readonly static?: boolean }) => (
  <ButtonPrimitive
    data-slot="button"
    data-variant={variant}
    data-size={size}
    type={type}
    className={cn(
      buttonVariants({ size, variant }),
      !isStatic && "motion-safe:active:not-disabled:scale-[0.96]",
      className
    )}
    {...props}
  />
);

export { Button, buttonVariants };
