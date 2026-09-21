import * as React from "react";

import { cn } from "../../lib/utils.js";

const Card = ({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) => (
  <div
    data-slot="card"
    data-size={size}
    className={cn(
      "group/card border-border bg-muted/72 text-card-foreground shadow-foreground/8 flex flex-col rounded-2xl border text-sm shadow-xs [--card-spacing:--spacing(6)] data-[size=sm]:[--card-spacing:--spacing(4)] max-[360px]:[--card-spacing:--spacing(4)] md:[--card-spacing:--spacing(10)]",
      className
    )}
    {...props}
  />
);

const CardHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card-header"
    className={cn(
      "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-2xl px-(--card-spacing) pt-7 pb-7 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] md:pt-10 [.border-b]:pb-(--card-spacing)",
      className
    )}
    {...props}
  />
);

const CardTitle = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card-title"
    className={cn(
      "font-heading text-task-mobile/8 md:text-task-desktop/9 font-semibold tracking-tight group-data-[size=sm]/card:text-lg",
      className
    )}
    {...props}
  />
);

const CardDescription = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    data-slot="card-description"
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
);

const CardAction = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card-action"
    className={cn(
      "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
      className
    )}
    {...props}
  />
);

const CardContent = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card-content"
    className={cn("flex flex-col gap-7 px-(--card-spacing) pb-8", className)}
    {...props}
  />
);

const CardFooter = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card-footer"
    className={cn(
      "text-muted-foreground flex min-h-18 flex-wrap items-center justify-center gap-x-1 rounded-b-2xl px-6 py-3 text-sm",
      className
    )}
    {...props}
  />
);

// Groups a card's primary content above its secondary footer.
const CardBody = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card-body"
    className={cn("border-border bg-card rounded-2xl border-b", className)}
    {...props}
  />
);

export {
  CardBody,
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
