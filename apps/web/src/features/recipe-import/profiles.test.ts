import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  RecipeImportProfileAlias,
  RecipeImportPublicProfileConfiguration,
  resolveRecipeImportProfileAlias,
} from "./profiles.js";

const configuration = Schema.decodeUnknownSync(
  RecipeImportPublicProfileConfiguration
)({
  defaultAlias: "home",
  profiles: [
    { alias: "home", label: "Our household" },
    { alias: "test-kitchen", label: "Test kitchen" },
  ],
});

describe("recipe import public profiles", () => {
  it("accepts only compact opaque aliases", () => {
    expect(Schema.decodeUnknownSync(RecipeImportProfileAlias)("home")).toBe(
      "home"
    );
    expect(() =>
      Schema.decodeUnknownSync(RecipeImportProfileAlias)(" household A ")
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(RecipeImportProfileAlias)("household/A")
    ).toThrow();
  });

  it.each([undefined, "", "unknown", " household A "])(
    "canonicalizes %s to the configured default",
    (candidate) => {
      expect(resolveRecipeImportProfileAlias(configuration, candidate)).toBe(
        "home"
      );
    }
  );

  it("preserves a configured alias and serializes only aliases and labels", () => {
    expect(resolveRecipeImportProfileAlias(configuration, "test-kitchen")).toBe(
      "test-kitchen"
    );
    const serialized = JSON.stringify(configuration);
    expect(JSON.parse(serialized)).toEqual({
      defaultAlias: "home",
      profiles: [
        { alias: "home", label: "Our household" },
        { alias: "test-kitchen", label: "Test kitchen" },
      ],
    });
  });
});
