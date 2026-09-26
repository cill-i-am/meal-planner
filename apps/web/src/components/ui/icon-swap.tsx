import type { LucideIcon } from "lucide-react";

import { cn } from "../../lib/utils.js";

const iconTransition =
  "motion-safe:transition-[opacity,filter,scale] motion-safe:duration-300 motion-safe:ease-icon-swap";

const IconSwap = ({
  active,
  activeIcon: ActiveIcon,
  inactiveIcon: InactiveIcon,
}: {
  readonly active: boolean;
  readonly activeIcon: LucideIcon;
  readonly inactiveIcon: LucideIcon;
}) => (
  <span className="relative inline-grid" aria-hidden="true">
    <ActiveIcon
      strokeWidth={1.5}
      className={cn(
        "absolute inset-0",
        iconTransition,
        active
          ? "scale-100 opacity-100 blur-[0px]"
          : "scale-25 opacity-0 blur-xs"
      )}
    />
    <InactiveIcon
      strokeWidth={1.5}
      className={cn(
        iconTransition,
        active
          ? "scale-25 opacity-0 blur-xs"
          : "scale-100 opacity-100 blur-[0px]"
      )}
    />
  </span>
);

export { IconSwap };
