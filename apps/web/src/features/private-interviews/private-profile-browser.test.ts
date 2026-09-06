import { afterEach, expect, it, vi } from "vitest";

import { continuePrivateConfirmation } from "./private-profile-browser.js";

afterEach(() => vi.unstubAllGlobals());
it.each([
  [204, "accepted"],
  [401, "authentication_required"],
  [503, "unavailable"],
] as const)(
  "sends only confirmation metadata and active generation for HTTP %s",
  async (status, outcome) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetch);
    const { signal } = new AbortController();
    expect(
      await continuePrivateConfirmation(
        "session",
        "mutation",
        "generation",
        signal
      )
    ).toBe(outcome);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/v1/private-interviews/session/confirmations/mutation",
      {
        credentials: "same-origin",
        headers: { "x-private-output-generation": "generation" },
        method: "POST",
        signal,
      }
    );
  }
);
