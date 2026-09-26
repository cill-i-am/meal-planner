import { Option, Schema } from "effect";

import { SignInInput, SignUpInput } from "../auth/auth-input.js";
import { decodeAuthSearch } from "../auth/auth-navigation.js";

export const RecoveryRequest = Schema.Struct({
  email: SignInInput.fields.email,
});
export const NewPassword = Schema.Struct({
  confirmation: Schema.String,
  password: SignUpInput.fields.password,
}).check(
  Schema.makeFilter(
    ({ password, confirmation }) =>
      password === confirmation || {
        issue: "Passwords must match.",
        path: ["confirmation"],
      }
  )
);
export const requestValidator = Schema.toStandardSchemaV1(RecoveryRequest);
export const passwordValidator = Schema.toStandardSchemaV1(NewPassword);
const Search = Schema.Struct({
  error: Schema.optional(Schema.String),
  token: Schema.optional(Schema.String),
});
export const decodeRecoverySearch = (input: Record<string, unknown>) => {
  const parsed = Schema.decodeUnknownOption(Search)(input);
  const value = Option.isSome(parsed) ? parsed.value : {};
  return { ...decodeAuthSearch(input), error: value.error, token: value.token };
};
