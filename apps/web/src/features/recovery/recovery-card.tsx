import type { ReactNode } from "react";

import { EntryFormSurface, EntryLayout } from "../auth/index.js";

export const RecoveryCard = ({
  title,
  description,
  children,
  footer,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) => (
  <EntryLayout>
    <EntryFormSurface className="mx-auto pt-26 md:pt-31">
      <div className="flex flex-col">
        <h1
          id="auth-title"
          tabIndex={-1}
          className="font-display text-entry-mobile tracking-entry md:text-entry-desktop font-normal focus:outline-none motion-safe:[view-transition-name:auth-heading]"
        >
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground mt-6 text-sm leading-5.75">
            {description}
          </p>
        )}
        <div className="mt-10 flex flex-col">{children}</div>
        {footer && <div className="mt-4 flex justify-center">{footer}</div>}
      </div>
    </EntryFormSurface>
  </EntryLayout>
);
