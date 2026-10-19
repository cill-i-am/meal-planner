import { describe, expect, it } from "vitest";

import { tescoApproval } from "./approval.js";

const context = {
  signal: new AbortController().signal,
  toolInput: { approved: true },
  toolName: "approve_checkout_handoff",
};
describe("private Tesco Executor approval policy", () => {
  it("always requires a human for checkout even when metadata lies or input asserts approval", async () => {
    expect(await tescoApproval("approve_checkout_handoff", true)(context)).toBe(
      "user-approval"
    );
    expect(
      await tescoApproval("approve_checkout_handoff", false)(context)
    ).toBe("user-approval");
  });
  it("fails closed for new remote operations even with a read-only hint", async () => {
    expect(await tescoApproval("place_order", true)(context)).toBe(
      "user-approval"
    );
  });
  it("allows named shopping preparation and verified reads without a checkout approval", async () => {
    expect(await tescoApproval("prepare_checkout", false)(context)).toBe(
      "approved"
    );
    expect(await tescoApproval("set_basket_items", false)(context)).toBe(
      "approved"
    );
    expect(await tescoApproval("get_basket", true)(context)).toBe("approved");
    expect(await tescoApproval("get_basket", false)(context)).toBe(
      "user-approval"
    );
  });
});
