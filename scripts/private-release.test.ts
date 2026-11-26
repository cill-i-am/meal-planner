import { describe, expect, it } from "vitest";

import {
  readSigenPolicy,
  requireLiveBindings,
  requireSafePlan,
  targetSpecs,
} from "./private-release.js";

const account = "a".repeat(32);
const spec = targetSpecs.tesco;

const row = {
  action: "update",
  bindings: [{ action: "noop", sid: "TescoSessionObject" }],
  fqn: "TescoMcp",
  logicalId: "TescoMcp",
  resourceType: "Cloudflare.Worker",
} as const;

const owner = {
  action: "update",
  state: {
    attr: {
      accountId: account,
      durableObjectNamespaces: { TescoSessionObject: spec.namespaceId },
      secretNames: spec.secretNames,
      workerName: spec.worker,
    },
    status: "updated",
  },
} as const;

const plan = {
  actions: [],
  native: {
    actionDeletions: {},
    actions: {},
    deletions: {},
    resources: { TescoMcp: owner },
  },
  resources: [row],
  stack: { name: "TescoMcp", stage: "prod" },
} as const;

describe("private integration release guard", () => {
  it("permits a code-only update of the existing Worker", () => {
    expect(requireSafePlan(plan, spec, account)).toBe("update");
  });

  it("permits a no-op without treating it as a release mutation", () => {
    expect(
      requireSafePlan(
        {
          ...plan,
          native: {
            ...plan.native,
            resources: { TescoMcp: { ...owner, action: "noop" } },
          },
          resources: [{ ...row, action: "noop" }],
        },
        spec,
        account
      )
    ).toBe("noop");
  });

  it.each(["create", "adopted", "replace", "delete", "orphaned"] as const)(
    "refuses %s even if its advertised Worker is present",
    (action) => {
      expect(() =>
        requireSafePlan(
          {
            ...plan,
            resources: [{ ...row, action }],
          },
          spec,
          account
        )
      ).toThrow();
    }
  );

  it.each(["create", "delete", "update"] as const)(
    "refuses binding %s even on a Worker update",
    (action) => {
      expect(() =>
        requireSafePlan(
          {
            ...plan,
            resources: [{ ...row, bindings: [{ action, sid: "secret" }] }],
          },
          spec,
          account
        )
      ).toThrow();
    }
  );

  it("refuses a different account, integration, or stage", () => {
    expect(() => requireSafePlan(plan, spec, "b".repeat(32))).toThrow();
    expect(() => requireSafePlan(plan, targetSpecs.sigen, account)).toThrow();
    expect(() =>
      requireSafePlan(
        {
          ...plan,
          stack: { name: "TescoMcp", stage: "pr-1" },
        },
        spec,
        account
      )
    ).toThrow();
  });

  it.each([
    { ...owner, renamedFrom: ["old"] },
    { ...owner, adopting: true },
    { ...owner, state: { ...owner.state, status: "updating" } },
    {
      ...owner,
      state: { ...owner.state, attr: { ...owner.state.attr, secretNames: [] } },
    },
    {
      ...owner,
      state: {
        ...owner.state,
        attr: {
          ...owner.state.attr,
          durableObjectNamespaces: { TescoSessionObject: "wrong" },
        },
      },
    },
  ])("refuses changed, foreign, or unsettled ownership", (changed) => {
    expect(() =>
      requireSafePlan(
        {
          ...plan,
          native: { ...plan.native, resources: { TescoMcp: changed } },
        },
        spec,
        account
      )
    ).toThrow();
  });

  it("ignores unrelated rate limit metadata and requires exact live secret and DO names", () => {
    const bindings = [
      ...spec.secretNames.map((name) => ({ name, type: "secret_text" })),
      {
        name: "TESCO_MCP_LIMIT",
        namespace_id: "rate-limit",
        type: "ratelimit",
      },
      {
        class_name: spec.namespaceBinding,
        name: spec.namespaceBinding,
        namespace_id: spec.namespaceId,
        type: "durable_object_namespace",
      },
    ];
    expect(() =>
      requireLiveBindings({ result: { bindings }, success: true }, spec)
    ).not.toThrow();
    expect(() =>
      requireLiveBindings(
        {
          result: { bindings: bindings.slice(1) },
          success: true,
        },
        spec
      )
    ).toThrow();
  });

  it("distinguishes intentional empty Sigen allowlists from an unset key", () => {
    const policy = {
      SIGEN_CONTROLS_ENABLED: "false",
      SIGEN_ENABLED_ACTIVE_PROFILE_LIMITS: "",
      SIGEN_ENABLED_OPERATIONS: "",
    };
    expect(readSigenPolicy(JSON.stringify(policy))).toEqual(policy);
    expect(() =>
      readSigenPolicy(JSON.stringify({ SIGEN_CONTROLS_ENABLED: "false" }))
    ).toThrow();
    expect(() =>
      readSigenPolicy(JSON.stringify({ ...policy, unexpected: "value" }))
    ).toThrow();
  });
});
