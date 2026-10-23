import { Option, Schema } from "effect";

const AuthSearch = Schema.Struct({ redirect: Schema.optional(Schema.String) });
const parseSearch = Schema.decodeUnknownOption(AuthSearch);
const hasOAuthSignature = Schema.is(Schema.Struct({ sig: Schema.String }));

/** Preserve provider signatures and repeated parameters byte-for-byte. */
export const readOAuthQuery = (search: string): string | undefined =>
  new URLSearchParams(search).has("sig") ? search : undefined;

export const isOAuthConsentReturn = (redirect: string): boolean => {
  const destination = new URL(redirect, "https://meal-planner.invalid");
  return (
    destination.origin === "https://meal-planner.invalid" &&
    destination.pathname === "/oauth/consent" &&
    readOAuthQuery(destination.search) !== undefined
  );
};

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
    destination.pathname.startsWith("//") ||
    ["/login", "/signup", "/forgot-password", "/reset-password"].includes(
      destination.pathname
    )
  ) {
    return { redirect: "/" };
  }
  return {
    redirect: destination.pathname + destination.search + destination.hash,
  };
};

/** Adding a default query value makes Router rewrite the signed OAuth query. */
export const decodeAuthEntrySearch = (
  input: Record<string, unknown>
): { redirect?: string } =>
  hasOAuthSignature(input) ? {} : decodeAuthSearch(input);
