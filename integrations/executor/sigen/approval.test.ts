import { describe, expect, it } from "vitest";

import { sigenApproval } from "./approval.js";

const context = {
  signal: new AbortController().signal,
  toolInput: { mode: "always" },
  toolName: "approve_command",
};
describe("Sigen Executor approvals", () => {
  it("requires confirmation for approval and unknown operations regardless of remote hints", async () => {
    expect(await sigenApproval("approve_command", true)(context)).toBe(
      "user-approval"
    );
    expect(await sigenApproval("approve_command", false)(context)).toBe(
      "user-approval"
    );
    expect(await sigenApproval("set_new_setting", true)(context)).toBe(
      "user-approval"
    );
  });
  it("leaves saved command authorization to the service without adding a second prompt", async () => {
    expect(await sigenApproval("prepare_command", false)(context)).toBe(
      "approved"
    );
    expect(await sigenApproval("execute_command", false)(context)).toBe(
      "approved"
    );
    expect(await sigenApproval("revoke_approval_grant", false)(context)).toBe(
      "approved"
    );
    expect(await sigenApproval("get_command", true)(context)).toBe("approved");
    expect(await sigenApproval("get_command", false)(context)).toBe(
      "user-approval"
    );
  });
});
