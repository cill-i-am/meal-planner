import type { LucideIcon } from "lucide-react";
import { m, useReducedMotion } from "motion/react";

const iconEase = [0.2, 0, 0, 1] as const;

const IconSwap = ({
  active,
  activeIcon: ActiveIcon,
  inactiveIcon: InactiveIcon,
}: {
  readonly active: boolean;
  readonly activeIcon: LucideIcon;
  readonly inactiveIcon: LucideIcon;
}) => {
  const reducedMotion = useReducedMotion();
  const transition = { duration: reducedMotion ? 0 : 0.3, ease: iconEase };

  return (
    <span className="relative inline-grid" aria-hidden="true">
      <m.span
        className="absolute inset-0 grid"
        initial={false}
        animate={{
          filter: active ? "blur(0px)" : "blur(4px)",
          opacity: active ? 1 : 0,
          scale: active ? 1 : 0.25,
        }}
        transition={transition}
      >
        <ActiveIcon strokeWidth={1.5} />
      </m.span>
      <m.span
        className="inline-grid"
        initial={false}
        animate={{
          filter: active ? "blur(4px)" : "blur(0px)",
          opacity: active ? 0 : 1,
          scale: active ? 0.25 : 1,
        }}
        transition={transition}
      >
        <InactiveIcon strokeWidth={1.5} />
      </m.span>
    </span>
  );
};

export { IconSwap };
