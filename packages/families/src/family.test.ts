import { Schema } from "effect";
import { expect, it } from "vitest";

import { CreateFamily, Family, UpdateFamily } from "./family.js";

it("accepts family display names independently of slugs and rejects caller-supplied authority", () => {
  const input = { mutationId: "create-family-1111", name: "  Murphy family  " };
  expect(Schema.decodeUnknownSync(CreateFamily)(input).name).toBe(
    "Murphy family"
  );
  for (const extra of [
    { userId: "other" },
    { slug: "chosen" },
    { role: "owner" },
    { setup: { status: "complete" } },
  ]) {
    expect(() =>
      Schema.decodeUnknownSync(CreateFamily)({ ...input, ...extra })
    ).toThrow();
  }
  expect(() =>
    Schema.decodeUnknownSync(UpdateFamily)({
      mutationId: "rename-family-1111",
      name: "Changed",
    })
  ).toThrow();
});
it("requires a completion time only for completed family setup", () => {
  const family = {
    canManage: true,
    createdAtEpochMs: 1,
    id: "family-id",
    name: "Family",
    slug: "family",
    updatedAtEpochMs: 1,
    version: 1,
  };
  expect(() =>
    Schema.decodeUnknownSync(Family)({
      ...family,
      setup: { status: "in_progress" },
    })
  ).not.toThrow();
  expect(() =>
    Schema.decodeUnknownSync(Family)({
      ...family,
      setup: { status: "complete" },
    })
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(Family)({
      ...family,
      setup: { completedAtEpochMs: 2, status: "complete" },
    })
  ).not.toThrow();
});
