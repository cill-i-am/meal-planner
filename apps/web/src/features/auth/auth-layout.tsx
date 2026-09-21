import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export const AuthLayout = ({
  children,
  header,
  progress,
}: {
  readonly children: ReactNode;
  readonly header?: ReactNode;
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
    <div className="auth-experience" ref={surface}>
      <header className="auth-header">
        <div className="auth-brand">
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24">
            <circle cx="6" cy="6" r="5" />
            <circle cx="18" cy="6" r="5" />
            <circle cx="6" cy="18" r="5" />
            <circle cx="18" cy="18" r="5" />
          </svg>
          <span>Meal Planner</span>
        </div>
        {header}
      </header>
      {progress}
      <main className="auth-main">
        <div aria-hidden="true" className="auth-glow" />
        {children}
      </main>
    </div>
  );
};
