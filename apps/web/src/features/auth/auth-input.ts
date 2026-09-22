import { EmailAddress } from "@meal-planner/household-api";
import { Schema } from "effect";

const isEmailAddress = Schema.is(EmailAddress);
const Email = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Enter your email." }).abort(),
  Schema.makeFilter(
    (value) =>
      isEmailAddress(value) || {
        issue: "Enter a valid email address.",
        path: [],
      }
  )
).pipe(Schema.decodeTo(EmailAddress));
export const SignInInput = Schema.Struct({
  email: Email,
  password: Schema.String.check(
    Schema.isMinLength(1, { message: "Enter your password." })
  ),
});
export const SignUpInput = Schema.Struct({
  email: Email,
  name: Schema.Trim.check(
    Schema.isMinLength(1, { message: "Enter your name." }),
    Schema.isMaxLength(80, { message: "Use 80 characters or fewer." })
  ),
  password: Schema.String.check(
    Schema.isMinLength(1, { message: "Create a password." }).abort(),
    Schema.isMinLength(8, { message: "Use at least 8 characters." }),
    Schema.isMaxLength(128, { message: "Use 128 characters or fewer." })
  ),
});
export const signInValidator = Schema.toStandardSchemaV1(SignInInput);
export const signUpValidator = Schema.toStandardSchemaV1(SignUpInput);
export const parseSignIn = Schema.decodeUnknownSync(SignInInput);
export const parseSignUp = Schema.decodeUnknownSync(SignUpInput);
