import { deployedWebsiteHostname, websiteDevPort } from "./website-address.js";

/** OAuth issuer/audiences come from deployment configuration, never request Host. */
export const configuredPublicOrigin = (input: {
  readonly configured: string;
  readonly dev: boolean;
  readonly stage: string;
}): string => {
  let origin = input.configured;
  if (origin === "") {
    const hostname = deployedWebsiteHostname(input.dev, input.stage);
    if (input.dev) {
      origin = `http://localhost:${websiteDevPort}`;
    } else if (hostname) {
      origin = `https://${hostname}`;
    } else {
      // Preview stages require an explicit OAuth issuer.
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
