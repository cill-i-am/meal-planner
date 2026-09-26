import { Ring } from "loading-dev";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";

type PendingButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  readonly children: ReactNode;
  readonly pending: boolean;
  readonly pendingLabel: string;
};

/** A shadcn button with a stable-width, labelled pending state. */
const PendingButton = ({
  children,
  className,
  disabled,
  pending,
  pendingLabel,
  ...props
}: PendingButtonProps) => (
  <Button
    {...props}
    className={cn(className, pending && "disabled:opacity-100")}
    data-pending={pending || undefined}
    disabled={disabled || pending}
  >
    <span className="grid items-center justify-items-center">
      <span
        aria-hidden={pending}
        className={cn("col-start-1 row-start-1", pending && "invisible")}
      >
        {children}
      </span>
      {pending ? (
        <span
          className="col-start-1 row-start-1 flex items-center justify-center gap-1.5"
          role="status"
        >
          <span data-icon="inline-start" className="shrink-0">
            <Ring size={16} duration={1100} />
          </span>
          {pendingLabel}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 flex items-center justify-center gap-1.5"
        >
          <span data-icon="inline-start" className="size-4 shrink-0" />
          {pendingLabel}
        </span>
      )}
    </span>
  </Button>
);

export { PendingButton };
