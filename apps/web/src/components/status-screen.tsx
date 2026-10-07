import type { ReactNode } from "react";

import { AccountLayout } from "./account-layout.js";
import { Button } from "./ui/button.js";
import {
  Card,
  CardBody,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "./ui/card.js";

export const StatusScreen = ({
  title,
  description,
  retry,
  children,
  footer,
  action,
  pending = false,
}: {
  readonly title: string;
  readonly description?: string;
  readonly retry?: () => Promise<unknown>;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly action?: ReactNode;
  readonly pending?: boolean;
}) => (
  <AccountLayout headerAction={action} soundDisabled={pending}>
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
  </AccountLayout>
);
