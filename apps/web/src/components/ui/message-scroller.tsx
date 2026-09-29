import { MessageScroller as MessageScrollerPrimitive } from "@shadcn/react/message-scroller";
import { ArrowDownIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";

export {
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";

const MessageScrollerProvider = (
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) => <MessageScrollerPrimitive.Provider {...props} />;
const MessageScroller = ({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) => (
  <MessageScrollerPrimitive.Root
    data-slot="message-scroller"
    className={cn(
      "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
      className
    )}
    {...props}
  />
);
const MessageScrollerViewport = ({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) => (
  <MessageScrollerPrimitive.Viewport
    data-slot="message-scroller-viewport"
    className={cn(
      "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain contain-content data-pending-scroll:invisible",
      className
    )}
    {...props}
  />
);
const MessageScrollerContent = ({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) => (
  <MessageScrollerPrimitive.Content
    data-slot="message-scroller-content"
    className={cn("flex h-max min-h-full flex-col gap-6", className)}
    {...props}
  />
);
const MessageScrollerItem = ({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) => (
  <MessageScrollerPrimitive.Item
    data-slot="message-scroller-item"
    scrollAnchor={scrollAnchor}
    className={cn("min-w-0 shrink-0", className)}
    {...props}
  />
);
const MessageScrollerButton = ({
  direction = "end",
  className,
  children,
  render,
  variant = "secondary",
  size = "icon-sm",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) => (
  <MessageScrollerPrimitive.Button
    data-slot="message-scroller-button"
    direction={direction}
    data-direction={direction}
    className={cn(
      "border-border bg-background text-foreground absolute inset-s-1/2 -translate-x-1/2 transition-[translate,scale,opacity] duration-200 data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full",
      className
    )}
    render={render ?? <Button variant={variant} size={size} />}
    {...props}
  >
    {children ?? (
      <>
        <ArrowDownIcon />
        <span className="sr-only">
          {direction === "end" ? "Scroll to end" : "Scroll to start"}
        </span>
      </>
    )}
  </MessageScrollerPrimitive.Button>
);
export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
};
