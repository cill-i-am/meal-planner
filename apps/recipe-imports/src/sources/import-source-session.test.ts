import { describe, expect, it } from "vitest";

import {
  decodeTikTokMediaSession,
  mediaSessionCookieHeader,
} from "./import-source-session.js";

const encodeJar = (...records: readonly string[]) =>
  new TextEncoder().encode(
    ["# Netscape HTTP Cookie File", ...records, ""].join("\n")
  );

describe("ephemeral TikTok media session", () => {
  it("selects only domain, path, secure, and expiry-valid cookies", () => {
    const session = decodeTikTokMediaSession(
      encodeJar(
        "v16m.tiktokcdn.com\tFALSE\t/\tTRUE\t4102444800\thost_only\tone",
        ".tiktokcdn.com\tTRUE\t/media\tTRUE\t4102444800\tpath_scoped\ttwo",
        ".tiktokcdn.com\tTRUE\t/private\tTRUE\t4102444800\twrong_path\tthree",
        ".tiktokcdn.com\tTRUE\t/\tTRUE\t1\texpired\tfour",
        ".tiktokcdn.com\tTRUE\t/\tFALSE\t4102444800\tnon_secure\tfive"
      )
    );

    expect(
      mediaSessionCookieHeader(
        session,
        new URL("https://v16m.tiktokcdn.com/media/video.mp4"),
        2_000_000_000
      )
    ).toBe("path_scoped=two; host_only=one; non_secure=five");
    expect(
      mediaSessionCookieHeader(
        session,
        new URL("https://v19.tiktokcdn.com/media/video.mp4"),
        2_000_000_000
      )
    ).toBe("path_scoped=two; non_secure=five");
    expect(
      mediaSessionCookieHeader(
        session,
        new URL("http://v16m.tiktokcdn.com/media/video.mp4"),
        2_000_000_000
      )
    ).toBe("non_secure=five");
  });

  it("is an opaque non-serializable in-memory capability", () => {
    const session = decodeTikTokMediaSession(
      encodeJar(
        ".tiktokcdn.com\tTRUE\t/\tTRUE\t4102444800\tsynthetic_session\topaque"
      )
    );

    expect(Object.keys(session)).toEqual([]);
    expect(JSON.stringify(session)).toBe("{}");
    expect(Reflect.ownKeys(session)).toEqual([]);
  });

  it.each([
    encodeJar(".example.com\tTRUE\t/\tTRUE\t4102444800\tname\tvalue"),
    encodeJar(".tiktokcdn.com\tTRUE\t/\tTRUE\t4102444800\tinvalid name\tvalue"),
    encodeJar(
      ".tiktokcdn.com\tTRUE\t/\tTRUE\t4102444800\tname\tvalue;injected"
    ),
    new TextEncoder().encode("not-a-netscape-cookie-jar\n"),
  ])("rejects malformed or out-of-policy cookie jars", (jar) => {
    expect(() => decodeTikTokMediaSession(jar)).toThrow(
      "invalid ephemeral media session"
    );
  });
});
