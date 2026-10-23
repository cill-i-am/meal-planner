import { describe, expect, it } from "vitest";

import { configuredPublicOrigin } from "./public-origin.js";

describe("configured OAuth public origin", () => {
  it("selects deployment-owned addresses and leaves arbitrary previews disabled", () => {
    expect(
      configuredPublicOrigin({ configured: "", dev: true, stage: "prod" })
    ).toBe("http://localhost:4399");
    expect(
      configuredPublicOrigin({ configured: "", dev: false, stage: "prod" })
    ).toBe("https://ceird.app");
    expect(
      configuredPublicOrigin({ configured: "", dev: false, stage: "e2e" })
    ).toBe("https://e2e.ceird.app");
    expect(
      configuredPublicOrigin({
        configured: "",
        dev: false,
        stage: "preview-123",
      })
    ).toBe("");
    expect(
      configuredPublicOrigin({
        configured: "https://preview.example.com",
        dev: false,
        stage: "preview-123",
      })
    ).toBe("https://preview.example.com");
  });

  it("rejects paths, credentials, alternate encodings, fragments and insecure deployed origins", () => {
    for (const configured of [
      "https://ceird.app/",
      "https://ceird.app/path",
      "https://ceird.app?host=evil",
      "https://ceird.app#evil",
      "https://user:password@ceird.app",
      "https://CEIRD.app",
      "http://ceird.app",
      "http://localhost:4399",
      "not a URL",
    ]) {
      expect(() =>
        configuredPublicOrigin({ configured, dev: false, stage: "prod" })
      ).toThrow();
    }
    expect(() =>
      configuredPublicOrigin({
        configured: "http://evil.example",
        dev: true,
        stage: "dev",
      })
    ).toThrow();
    expect(
      configuredPublicOrigin({
        configured: "http://127.0.0.1:4399",
        dev: true,
        stage: "dev",
      })
    ).toBe("http://127.0.0.1:4399");
  });
});
