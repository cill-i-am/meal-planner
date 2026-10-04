import { useHydrated } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AccountLayout } from "../../components/account-layout.js";
import { Badge } from "../../components/ui/badge.js";
import { Separator } from "../../components/ui/separator.js";

const SetupProgressBar = ({
  step,
}: {
  readonly step: "family" | "people" | "ready";
}) => (
  <nav
    aria-label="Setup progress"
    className="flex h-13 items-center justify-center gap-4 px-4 text-sm"
  >
    <span className="flex items-center gap-2">
      <CheckIcon aria-hidden="true" className="size-4" strokeWidth={1.5} />
      Account
    </span>
    <Separator className="w-6" />
    <span
      aria-current={step === "family" ? "step" : undefined}
      className="flex items-center gap-2"
    >
      {step === "family" ? (
        <Badge size="step">2</Badge>
      ) : (
        <CheckIcon aria-hidden="true" className="size-4" strokeWidth={1.5} />
      )}{" "}
      Family
    </span>
    <Separator className="w-6" />
    <span
      aria-current={step === "people" ? "step" : undefined}
      className="flex items-center gap-2"
    >
      {step === "ready" ? (
        <CheckIcon aria-hidden="true" className="size-4" strokeWidth={1.5} />
      ) : (
        <Badge
          variant={step === "people" ? "default" : "secondary"}
          size="step"
        >
          3
        </Badge>
      )}{" "}
      People
    </span>
  </nav>
);

export const SetupFrame = ({
  children,
  action,
  step,
  contentClassName,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly step?: "family" | "people" | "ready";
  readonly contentClassName?: string;
}) => {
  const hydrated = useHydrated();
  return (
    <AccountLayout
      contentClassName={contentClassName}
      headerAction={
        <fieldset disabled={!hydrated} className="contents">
          {action}
        </fieldset>
      }
      progress={step ? <SetupProgressBar step={step} /> : undefined}
    >
      <fieldset disabled={!hydrated} className="contents">
        {children}
      </fieldset>
    </AccountLayout>
  );
};
