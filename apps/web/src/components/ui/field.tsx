// Adapted from shadcn/ui base-nova Field (MIT); see SHADCN.md.
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";
import { Label } from "./label.js";

export const Field = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    role="group"
    data-slot="field"
    className={cn(
      "group/field data-[invalid=true]:text-destructive flex w-full flex-col gap-2",
      className
    )}
    {...props}
  />
);
export const FieldLabel = ({
  className,
  ...props
}: ComponentProps<typeof Label>) => (
  <Label
    data-slot="field-label"
    className={cn(
      "flex w-fit gap-2 text-sm leading-snug font-medium",
      className
    )}
    {...props}
  />
);
export const FieldDescription = ({
  className,
  ...props
}: ComponentProps<"p">) => (
  <p
    data-slot="field-description"
    className={cn("text-muted-foreground text-sm font-normal", className)}
    {...props}
  />
);
export const FieldError = ({
  className,
  children,
  ...props
}: ComponentProps<"div">) =>
  children ? (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-destructive text-sm font-normal", className)}
      {...props}
    >
      {children}
    </div>
  ) : null;
