import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { XIcon } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.js";

type OverlayMode = "dialog" | "drawer";
type OverlayVariant = "dialog" | "desktop-drawer" | "mobile-drawer";

const OverlayContext = React.createContext<OverlayMode | null>(null);

const useOverlayMode = (): OverlayMode => {
  const mode = React.useContext(OverlayContext);
  if (mode === null) {
    throw new Error("Overlay components must be rendered within Overlay.Root.");
  }
  return mode;
};

const mobileQuery = "(max-width: 767px)";

const subscribeToMobile = (change: () => void): (() => void) => {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};

const isMobile = (): boolean => window.matchMedia(mobileQuery).matches;

/** Uses a desktop snapshot for SSR, then switches to the mobile drawer after hydration. */
const useMobileOverlay = (): boolean =>
  React.useSyncExternalStore(subscribeToMobile, isMobile, () => false);

type DrawerOptions = Omit<
  DrawerPrimitive.Root.Props,
  "children" | "open" | "defaultOpen" | "onOpenChange" | "modal"
>;

type DialogOptions = Omit<
  DialogPrimitive.Root.Props,
  "children" | "open" | "defaultOpen" | "onOpenChange" | "modal"
>;

/** Base UI's dismissal reason and control methods for the active primitive. */
type OverlayChangeEventDetails =
  | DrawerPrimitive.Root.ChangeEventDetails
  | DialogPrimitive.Root.ChangeEventDetails;

interface OverlayRootProps {
  readonly children: React.ReactNode;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (
    open: boolean,
    details: OverlayChangeEventDetails
  ) => void;
  readonly desktop?: "dialog" | "drawer";
  readonly modal?: DialogPrimitive.Root.Props["modal"];
  /** Native Base UI drawer options for the mobile sheet, including snap points. */
  readonly drawerProps?: DrawerOptions;
  /** Native Base UI drawer options when desktop="drawer". */
  readonly desktopDrawerProps?: DrawerOptions;
  /** Native Base UI dialog options when desktop="dialog". */
  readonly dialogProps?: DialogOptions;
}

/** Selects a Base UI drawer below 768px and a dialog or right drawer on desktop. */
const OverlayRoot = ({
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  desktop = "dialog",
  modal = true,
  drawerProps,
  desktopDrawerProps,
  dialogProps,
}: OverlayRootProps) => {
  const mobile = useMobileOverlay();
  let desiredVariant: OverlayVariant = "dialog";
  if (mobile) {
    desiredVariant = "mobile-drawer";
  } else if (desktop === "drawer") {
    desiredVariant = "desktop-drawer";
  }
  const [variant, setVariant] = React.useState(desiredVariant);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const active = React.useRef(currentOpen);
  const latestVariant = React.useRef(desiredVariant);
  React.useLayoutEffect(() => {
    latestVariant.current = desiredVariant;
    if (currentOpen) {
      if (!active.current) {
        setVariant(desiredVariant);
      }
      active.current = true;
    } else if (!active.current) {
      setVariant(desiredVariant);
    }
  }, [currentOpen, desiredVariant]);
  const closeComplete = React.useCallback(() => {
    active.current = false;
    setVariant(latestVariant.current);
  }, []);
  const changeOpen = React.useCallback(
    (nextOpen: boolean, details: OverlayChangeEventDetails) => {
      onOpenChange?.(nextOpen, details);
      if (open === undefined && !details.isCanceled) {
        setInternalOpen(nextOpen);
      }
    },
    [onOpenChange, open]
  );

  if (variant !== "dialog") {
    const drawerIsMobile = variant === "mobile-drawer";
    const options = drawerIsMobile ? drawerProps : desktopDrawerProps;
    return (
      <OverlayContext.Provider value="drawer">
        <Drawer
          {...options}
          swipeDirection={
            drawerIsMobile ? "down" : (options?.swipeDirection ?? "right")
          }
          showSwipeHandle={drawerIsMobile}
          virtualKeyboard={drawerIsMobile}
          modal={modal}
          open={currentOpen}
          onOpenChange={changeOpen}
          onOpenChangeComplete={(next) => {
            if (!next) {
              closeComplete();
            }
            options?.onOpenChangeComplete?.(next);
          }}
        >
          {children}
        </Drawer>
      </OverlayContext.Provider>
    );
  }

  return (
    <OverlayContext.Provider value="dialog">
      <Dialog
        {...dialogProps}
        modal={modal}
        open={currentOpen}
        onOpenChange={changeOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            closeComplete();
          }
          dialogProps?.onOpenChangeComplete?.(next);
        }}
      >
        {children}
      </Dialog>
    </OverlayContext.Provider>
  );
};

type TriggerProps = DrawerPrimitive.Trigger.Props &
  DialogPrimitive.Trigger.Props;

const OverlayTrigger = (props: TriggerProps) =>
  useOverlayMode() === "drawer" ? (
    <DrawerTrigger {...props} />
  ) : (
    <DialogTrigger {...props} />
  );

type ContentProps = DrawerPrimitive.Popup.Props &
  DialogPrimitive.Popup.Props & {
    readonly showCloseButton?: boolean;
  };

const OverlayClose = (props: CloseProps) =>
  useOverlayMode() === "drawer" ? (
    <DrawerClose {...props} />
  ) : (
    <DialogClose {...props} />
  );

const OverlayCloseIcon = () => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger
        render={
          <OverlayClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-3 size-11"
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
);

const OverlayContent = ({
  className,
  children,
  showCloseButton = true,
  ...props
}: ContentProps) => {
  const mode = useOverlayMode();
  if (mode === "drawer") {
    return (
      <DrawerContent
        className={cn(
          "border-border bg-background shadow-surface max-h-[calc(100dvh-1rem)] rounded-t-3xl data-[swipe-axis=x]:max-h-none data-[swipe-direction=left]:rounded-l-none data-[swipe-direction=left]:rounded-r-3xl data-[swipe-direction=right]:rounded-l-3xl data-[swipe-direction=right]:rounded-r-none motion-reduce:transition-none",
          className
        )}
        {...props}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-6">{children}</div>
        {showCloseButton && <OverlayCloseIcon />}
      </DrawerContent>
    );
  }
  return (
    <DialogContent className={className} showCloseButton={false} {...props}>
      {children}
      {showCloseButton && <OverlayCloseIcon />}
    </DialogContent>
  );
};

const OverlayHeader = ({ className, ...props }: React.ComponentProps<"div">) =>
  useOverlayMode() === "drawer" ? (
    <DrawerHeader
      className={cn(
        "px-6 pt-6 pr-16 pb-0 text-left group-data-[swipe-axis=y]/drawer-popup:text-left",
        className
      )}
      {...props}
    />
  ) : (
    <DialogHeader className={cn("pr-12", className)} {...props} />
  );

const OverlayTitle = (
  props: DrawerPrimitive.Title.Props & DialogPrimitive.Title.Props
) =>
  useOverlayMode() === "drawer" ? (
    <DrawerTitle
      {...props}
      className={cn("text-2xl leading-8 font-semibold", props.className)}
    />
  ) : (
    <DialogTitle {...props} />
  );

const OverlayDescription = (
  props: DrawerPrimitive.Description.Props & DialogPrimitive.Description.Props
) =>
  useOverlayMode() === "drawer" ? (
    <DrawerDescription {...props} />
  ) : (
    <DialogDescription {...props} />
  );

/** The scrollable region between the fixed header and footer. */
const OverlayBody = ({ className, ...props }: React.ComponentProps<"div">) => {
  const mode = useOverlayMode();
  return (
    <div
      data-slot="overlay-body"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain text-base [&_input]:text-base [&_textarea]:text-base",
        mode === "drawer" && "px-6",
        className
      )}
      {...props}
    />
  );
};

const OverlayFooter = ({ className, ...props }: React.ComponentProps<"div">) =>
  useOverlayMode() === "drawer" ? (
    <DrawerFooter
      className={cn(
        "border-border border-t px-6 pt-4 pb-[max(24px,env(safe-area-inset-bottom),var(--drawer-keyboard-inset,0px))]",
        className
      )}
      {...props}
    />
  ) : (
    <DialogFooter className={className} {...props} />
  );

type CloseProps = DrawerPrimitive.Close.Props & DialogPrimitive.Close.Props;

const Overlay = {
  Body: OverlayBody,
  Close: OverlayClose,
  Content: OverlayContent,
  Description: OverlayDescription,
  Footer: OverlayFooter,
  Header: OverlayHeader,
  Root: OverlayRoot,
  Title: OverlayTitle,
  Trigger: OverlayTrigger,
};

export { Overlay };
export type { OverlayChangeEventDetails };
