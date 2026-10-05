import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

import { InteractionSoundToggle } from "../../components/interaction-sound-toggle.js";
import { cn } from "../../lib/utils.js";

export const EntryLayout = ({
  children,
  headerAction,
}: {
  readonly children: ReactNode;
  readonly headerAction?: ReactNode;
}) => {
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    surface.current?.querySelector<HTMLElement>("h1")?.focus();
  }, []);

  return (
    <div
      data-theme="auth"
      className="bg-background text-foreground font-auth selection:text-foreground min-h-svh text-base/6 antialiased selection:bg-(--glow-lilac)"
      style={{ "--control-height": "48px" } as CSSProperties}
      ref={surface}
    >
      <header className="mx-auto flex h-20 w-full max-w-[1440px] items-center justify-between gap-4 px-6 md:h-24 md:px-16">
        <div className="flex shrink-0 items-center gap-3 text-lg font-medium tracking-tight">
          <svg
            aria-hidden="true"
            className="fill-foreground size-[22px]"
            viewBox="0 0 24 24"
          >
            <circle cx="6" cy="6" r="4.6" />
            <circle cx="18" cy="6" r="4.6" />
            <circle cx="6" cy="18" r="4.6" />
            <circle cx="18" cy="18" r="4.6" />
          </svg>
          <span>Meal Planner</span>
        </div>
        <div className="flex min-w-0 items-center gap-1 md:gap-3">
          <div className="hidden sm:block">
            <InteractionSoundToggle />
          </div>
          {headerAction}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] px-6 pb-16 md:px-16">
        {children}
      </main>
    </div>
  );
};

export const EntryFormSurface = ({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <div
    className={cn(
      "w-full max-w-[400px] motion-safe:[view-transition-name:auth-card]",
      className
    )}
  >
    {children}
  </div>
);
