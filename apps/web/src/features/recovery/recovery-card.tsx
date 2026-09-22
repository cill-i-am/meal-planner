import type { ReactNode } from "react";

import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../../components/ui/card.js";
import { AuthLayout } from "../auth/auth-layout.js";

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
  <AuthLayout>
    <Card
      className="w-full max-w-(--container-auth)"
      aria-labelledby="auth-title"
    >
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
        <CardContent>{children}</CardContent>
      </CardBody>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  </AuthLayout>
);
