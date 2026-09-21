import { Option, Schema } from "effect";

const AuthSearch = Schema.Struct({ redirect: Schema.optional(Schema.String) });
const parseSearch = Schema.decodeUnknownOption(AuthSearch);

/** Only same-origin application paths may survive an anonymous round trip. */
export const decodeAuthSearch = (
  input: Record<string, unknown>
): { redirect: string } => {
  const parsed = parseSearch(input);
  const redirect = Option.isSome(parsed) ? parsed.value.redirect : undefined;
  if (
    redirect === undefined ||
    !redirect.startsWith("/") ||
    redirect.startsWith("//") ||
    redirect.includes("\\") ||
    [...redirect].some((character) => (character.codePointAt(0) ?? 0) <= 32)
  ) {
    return { redirect: "/" };
  }
  const destination = new URL(redirect, "https://meal-planner.invalid");
  if (
    ["/login", "/signup", "/forgot-password"].includes(destination.pathname)
  ) {
    return { redirect: "/" };
  }
  return {
    redirect: destination.pathname + destination.search + destination.hash,
  };
};
