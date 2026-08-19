import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";

import { noConditionalEmptyObjectSpreadRule } from "../tools/oxlint/anti-slop/no-conditional-empty-object-spread.js";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "avoid" } as const;

describe("no-conditional-empty-object-spread", () => {
  it("does not offer a semantics-changing automatic fix", () => {
    expect(noConditionalEmptyObjectSpreadRule.meta?.fixable).toBeUndefined();
  });
});

tester.run(
  "anti-slop/no-conditional-empty-object-spread",
  noConditionalEmptyObjectSpreadRule,
  {
    invalid: [
      {
        code: "const result = { ...(value !== undefined ? { value } : {}) };",
        errors: [error],
      },
      {
        code: "const result = { ...(condition ? {} : { value }) };",
        errors: [error],
      },
    ],
    valid: [
      "const result = { value };",
      "const result = { ...values };",
      "const result = condition ? { value } : {};",
    ],
  }
);
