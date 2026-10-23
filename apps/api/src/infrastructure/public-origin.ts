/** OAuth issuer/audiences come from deployment configuration, never request Host. */
export const configuredPublicOrigin = (input: {
  readonly configured: string;
  readonly dev: boolean;
  readonly stage: string;
}): string => {
  let origin = input.configured;
  if (origin === "") {
    if (input.dev) {
      origin = "http://localhost:4399";
    } else if (input.stage === "prod") {
      origin = "https://ceird.app";
    } else if (input.stage === "e2e") {
      origin = "https://e2e.ceird.app";
    } else {
      // Arbitrary previews retain cookie auth but cannot issue OAuth grants.
      return "";
    }
  }
  const url = new URL(origin);
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (
    url.origin !== origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.protocol !== "https:" &&
      !(input.dev && local && url.protocol === "http:"))
  ) {
    throw new Error(
      "MEAL_PLANNER_PUBLIC_ORIGIN must be a canonical HTTPS origin (HTTP loopback is allowed only in development)."
    );
  }
  return origin;
};
