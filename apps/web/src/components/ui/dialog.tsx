import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type * as React from "react";

import { cn } from "../../lib/utils.js";
import { BaseMotionElement } from "./base-motion-element.js";
import { Button } from "./button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.js";

const Dialog = (props: DialogPrimitive.Root.Props) => (
  <DialogPrimitive.Root data-slot="dialog" {...props} />
);

const DialogTrigger = (props: DialogPrimitive.Trigger.Props) => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
);

const DialogPortal = (props: DialogPrimitive.Portal.Props) => (
  <DialogPrimitive.Portal data-slot="dialog-portal" keepMounted {...props} />
);

const DialogClose = (props: DialogPrimitive.Close.Props) => (
  <DialogPrimitive.Close data-slot="dialog-close" {...props} />
);

const DialogOverlay = ({
  className,
  render,
  ...props
}: DialogPrimitive.Backdrop.Props) => {
  const reducedMotion = useReducedMotion();

  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "bg-foreground/10 fixed inset-0 isolate z-50 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
      render={
        render ??
        ((renderProps, state) => (
          <BaseMotionElement
            baseProps={renderProps}
            initial={{ opacity: state.open && reducedMotion ? 1 : 0 }}
            animate={{ opacity: state.open ? 1 : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
          />
        ))
      }
    />
  );
};

const DialogContent = ({
  className,
  children,
  showCloseButton = true,
  render,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) => {
  const reducedMotion = useReducedMotion();

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/10 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-3xl p-6 text-sm ring-1 outline-none sm:max-w-lg",
          className
        )}
        {...props}
        render={
          render ??
          ((renderProps, state) => (
            <BaseMotionElement
              baseProps={renderProps}
              initial={{
                opacity: state.open && reducedMotion ? 1 : 0,
                scale: reducedMotion ? 1 : 0.95,
              }}
              animate={{
                opacity: state.open ? 1 : 0,
                scale: state.open || reducedMotion ? 1 : 0.95,
              }}
              transition={{
                duration: reducedMotion ? 0 : 0.2,
                ease: "easeOut",
              }}
            />
          ))
        }
      >
        {children}
        {showCloseButton && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DialogPrimitive.Close
                    data-slot="dialog-close"
                    render={
                      <Button
                        variant="ghost"
                        className="absolute top-2 right-2 size-11"
                        size="icon"
                        aria-label="Close"
                      />
                    }
                  />
                }
              >
                <XIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
};

const DialogHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="dialog-header"
    className={cn("flex shrink-0 flex-col gap-2", className)}
    {...props}
  />
);

const DialogFooter = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="dialog-footer"
    className={cn(
      "flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className
    )}
    {...props}
  />
);

const DialogTitle = ({ className, ...props }: DialogPrimitive.Title.Props) => (
  <DialogPrimitive.Title
    data-slot="dialog-title"
    className={cn(
      "font-heading text-foreground text-2xl leading-8 font-semibold",
      className
    )}
    {...props}
  />
);

const DialogDescription = ({
  className,
  ...props
}: DialogPrimitive.Description.Props) => (
  <DialogPrimitive.Description
    data-slot="dialog-description"
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
);

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
