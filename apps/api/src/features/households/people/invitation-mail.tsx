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
} from "../../email/index.js";

export interface InvitationMail {
  readonly email: EmailAddress;
  readonly familyName: string;
  readonly inviterName: string;
  readonly url: string;
}

/** Better Auth owns the invitation record; this renders its recipient message. */
export const renderInvitationMail = (mail: InvitationMail) =>
  renderEmail({
    element: (
      <EmailFrame preview={`Join ${mail.familyName} on Meal Planner`}>
        <Heading className="email-heading" style={headingStyle}>
          Join {mail.familyName}
        </Heading>
        <Text style={bodyStyle}>
          {mail.inviterName} invited you to join {mail.familyName} in Meal
          Planner. You can manage your own food preferences once you join.
        </Text>
        <Action label="View invitation" url={mail.url} />
        <Text style={noteStyle}>
          This invitation expires in 48 hours. If you were not expecting it, you
          can safely ignore this email.
        </Text>
      </EmailFrame>
    ),
    subject: "You’re invited to Meal Planner",
    to: mail.email,
  });
