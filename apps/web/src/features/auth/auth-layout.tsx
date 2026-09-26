import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { InteractionSoundToggle } from "../../components/interaction-sound-toggle.js";

export const AuthLayout = ({
  children,
  headerAction,
  progress,
}: {
  readonly children: ReactNode;
  readonly headerAction?: ReactNode;
  readonly progress?: ReactNode;
}) => {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    surface.current?.querySelector<HTMLElement>("h1")?.focus();
    const element = surface.current;
    if (element === null) {
      return;
    }
    let visible = true;
    const update = () => {
      element.dataset["paused"] = String(document.hidden || !visible);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <div
      data-theme="auth"
      className="group/auth bg-background text-foreground font-auth selection:text-foreground scrollbar-thumb-input scrollbar-track-background flex min-h-svh flex-col text-base/6 antialiased selection:bg-(--glow-lilac) motion-safe:[&_[data-slot=card-content]]:[view-transition-name:auth-fields] motion-safe:[&_[data-slot=card-footer]]:[view-transition-name:auth-footer] motion-safe:[&_[data-slot=card-header]]:[view-transition-name:auth-heading] motion-safe:[&_[data-slot=card]]:[view-transition-name:auth-card]"
      ref={surface}
    >
      <header className="border-border flex min-h-16 items-center justify-between gap-1 border-b px-4 sm:gap-4 sm:px-6 md:px-10">
        <div className="flex items-center gap-3 text-lg font-medium tracking-tight whitespace-nowrap">
          <svg
            aria-hidden="true"
            className="fill-foreground size-6 shrink-0"
            viewBox="0 0 24 24"
          >
            <circle cx="6" cy="6" r="5" />
            <circle cx="18" cy="6" r="5" />
            <circle cx="6" cy="18" r="5" />
            <circle cx="18" cy="18" r="5" />
          </svg>
          <span>Meal Planner</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <InteractionSoundToggle />
          {headerAction}
        </div>
      </header>
      {progress}
      <main className="relative isolate flex min-h-140 flex-1 flex-col items-center overflow-clip px-4 py-8 md:px-8 md:py-18">
        <div
          aria-hidden="true"
          className="bg-auth-glow motion-safe:animate-auth-drift motion-safe:group-has-[[data-slot=field]:focus-within]/auth:animate-auth-drift-paused motion-safe:group-data-[paused=true]/auth:animate-auth-drift-paused pointer-events-none absolute inset-0 -z-10 origin-[50%_20%] motion-reduce:animate-none"
        />
        {children}
      </main>
    </div>
  );
};
