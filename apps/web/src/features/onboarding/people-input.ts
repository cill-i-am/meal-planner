import { Schema } from "effect";

export const PersonNameInput = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Enter their name." }).abort(),
  Schema.isMaxLength(80, { message: "Use 80 characters or fewer." })
);
export const ParticipationInput = Schema.String.check(
  Schema.isPattern(/^(?:adult|dependant)$/u, {
    message: "Choose how they’ll take part.",
  })
);
export const InvitationEmailInput = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Enter their email." }).abort(),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, {
    message: "Enter a valid email address.",
  }),
  Schema.isMaxLength(254, { message: "Use 254 characters or fewer." })
);
