/* eslint-disable shadcn/no-inline-styles, shadcn/no-unknown-classes -- React Email templates use inline styles for mail-client compatibility. */
import type { EmailAddress } from "@meal-planner/household-api";
import { Heading, Text } from "react-email";

import {
  Action,
  EmailFrame,
  bodyStyle,
  headingStyle,
  noteStyle,
  renderEmail,
} from "../email/index.js";

export interface PasswordResetMail {
  readonly email: EmailAddress;
  readonly url: string;
}

/** The reset URL comes from Better Auth, which owns token expiry and use. */
export const renderPasswordResetMail = (mail: PasswordResetMail) =>
  renderEmail({
    element: (
      <EmailFrame preview="Choose a new Meal Planner password">
        <Heading className="email-heading" style={headingStyle}>
          Reset your password
        </Heading>
        <Text style={bodyStyle}>
          We received a request to reset your Meal Planner password. Use the
          link below to choose a new one.
        </Text>
        <Action label="Reset password" url={mail.url} />
        <Text style={noteStyle}>
          This link expires in 1 hour. If you did not request a password reset,
          you can safely ignore this email.
        </Text>
      </EmailFrame>
    ),
    subject: "Reset your Meal Planner password",
    to: mail.email,
  });
