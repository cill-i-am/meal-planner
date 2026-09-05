import { Cause } from "effect";
import { expect, it } from "vitest";

import { classifyProfileCause } from "./browser-operations.js";

it("distinguishes a decoded authentication rejection from an ambiguous failure", () => {
  expect(
    classifyProfileCause(
      Cause.fail({ code: "unauthorized", message: "Sign in", status: 401 })
    ).code
  ).toBe("authentication_required");
});

it("only releases a retained mutation for a definite decoded server rejection", () => {
  expect(
    classifyProfileCause(
      Cause.fail({ code: "stale_version", message: "Reload" })
    ).code
  ).toBe("stale_version");
  expect(
    classifyProfileCause(
      Cause.fail({ code: "mutation_collision", message: "Collision" })
    ).code
  ).toBe("mutation_collision");
  expect(
    classifyProfileCause(
      Cause.fail({ code: "profile_unavailable", message: "Unavailable" })
    ).code
  ).toBe("ambiguous");
  expect(
    classifyProfileCause(Cause.fail(new Error("response lost"))).code
  ).toBe("ambiguous");
  expect(
    classifyProfileCause(
      Cause.die({ code: "stale_version", message: "Not a server rejection" })
    ).code
  ).toBe("ambiguous");
});
