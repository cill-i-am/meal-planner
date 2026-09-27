import { EmailAddress } from "@meal-planner/household-api";
import { Schema } from "effect";

const isEmailAddress = Schema.is(EmailAddress);
export const PersonNameInput = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Enter their name." }).abort(),
  Schema.isMaxLength(80, { message: "Use 80 characters or fewer." })
);
export const ParticipationInput = Schema.String.check(
  Schema.isPattern(/^(?:adult|dependant)$/u, {
    message: "Choose Adult or Child.",
  })
);
export const InvitationEmailInput = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Enter their email." }).abort(),
  Schema.isMaxLength(254, { message: "Use 254 characters or fewer." }).abort(),
  Schema.makeFilter(
    (value) =>
      isEmailAddress(value) || {
        issue: "Enter a valid email address.",
        path: [],
      }
  )
).pipe(Schema.decodeTo(EmailAddress));
