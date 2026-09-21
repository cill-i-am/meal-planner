import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardBody,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "../../components/ui/card.js";
import { Separator } from "../../components/ui/separator.js";
import { AuthLayout } from "../auth/auth-layout.js";

export const SetupProgressBar = ({
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
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly step?: "family" | "people" | "ready";
}) => (
  <AuthLayout
    headerAction={action}
    progress={step ? <SetupProgressBar step={step} /> : undefined}
  >
    {children}
  </AuthLayout>
);

export const SetupError = ({ children }: { readonly children: ReactNode }) => (
  <Alert variant="destructive">
    <AlertDescription>{children}</AlertDescription>
  </Alert>
);

export const SetupStatus = ({
  title,
  description,
  retry,
  children,
  footer,
}: {
  readonly title: string;
  readonly description?: string;
  readonly retry?: () => Promise<unknown>;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
}) => (
  <AuthLayout>
    <Card className="w-full max-w-140">
      <CardBody>
        <CardHeader>
          <CardTitle>
            <h1
              id="auth-title"
              tabIndex={-1}
              className="text-task-mobile/8 md:text-task-desktop/9 font-semibold tracking-tight focus:outline-none"
            >
              {title}
            </h1>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {(children || retry) && (
          <CardContent>
            {children}
            {retry && (
              <Button
                onClick={() => {
                  void retry();
                }}
              >
                Try again
              </Button>
            )}
          </CardContent>
        )}
      </CardBody>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  </AuthLayout>
);
