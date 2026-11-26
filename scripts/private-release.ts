import type { StackPlan } from "alchemy/Alchemist";
import { Schema } from "effect";

const sigenPolicyNames = [
  "SIGEN_CONTROLS_ENABLED",
  "SIGEN_ENABLED_OPERATIONS",
  "SIGEN_ENABLED_ACTIVE_PROFILE_LIMITS",
] as const;

export const targetSpecs = {
  sigen: {
    entry: "sigen.alchemy.ts",
    namespaceBinding: "SigenAccountObject",
    namespaceId: "99c1133ab2c348bb91045bc1741a81eb",
    secretNames: [
      "SIGEN_OWNER_TOKEN_SHA256",
      "SIGEN_OPERATOR_TOKEN_SHA256",
      "SIGEN_SESSION_ENCRYPTION_KEY",
      ...sigenPolicyNames,
    ],
    stack: "SigenApi",
    worker: "sigen-api",
  },
  tesco: {
    entry: "apps/tesco/tesco.alchemy.ts",
    namespaceBinding: "TescoSessionObject",
    namespaceId: "14c7476c44974f408331b45282199651",
    secretNames: [
      "TESCO_EXECUTOR_TOKEN_SHA256",
      "TESCO_OPERATOR_TOKEN_SHA256",
      "TESCO_SESSION_ENCRYPTION_KEY",
    ],
    stack: "TescoMcp",
    worker: "tesco-mcp",
  },
} as const;

type Target = (typeof targetSpecs)[keyof typeof targetSpecs];

export const exactNames = (
  actual: readonly string[],
  expected: readonly string[]
) =>
  actual.length === expected.length &&
  expected.every((key) => actual.includes(key));

const Policy = Schema.Struct({
  SIGEN_CONTROLS_ENABLED: Schema.Literals(["false", "true"]),
  SIGEN_ENABLED_ACTIVE_PROFILE_LIMITS: Schema.String,
  SIGEN_ENABLED_OPERATIONS: Schema.String,
});

export const readSigenPolicy = (encoded: string) => {
  try {
    const candidate: unknown = JSON.parse(encoded);
    return Schema.decodeUnknownSync(Policy)(candidate, {
      onExcessProperty: "error",
    });
  } catch {
    throw new Error(
      "SIGEN_DEPLOY_POLICY_JSON must explicitly contain all three existing policy strings."
    );
  }
};

const PriorWorker = Schema.Struct({
  accountId: Schema.String,
  durableObjectNamespaces: Schema.Record(Schema.String, Schema.String),
  secretNames: Schema.Array(Schema.String),
  workerName: Schema.String,
});

const ExistingOwner = Schema.Struct({
  action: Schema.Literals(["noop", "update"]),
  adopting: Schema.optional(Schema.Boolean),
  renamedFrom: Schema.optional(Schema.Array(Schema.String)),
  state: Schema.Struct({
    attr: PriorWorker,
    status: Schema.Literals(["created", "updated"]),
  }),
});

type ReleasePlan = Pick<StackPlan, "actions" | "resources" | "stack"> & {
  readonly native: {
    readonly actionDeletions: Readonly<Record<string, unknown>>;
    readonly actions: Readonly<Record<string, unknown>>;
    readonly deletions: Readonly<Record<string, unknown>>;
    readonly resources: Readonly<Record<string, unknown>>;
  };
};

const requireWorkerRow = (plan: ReleasePlan, target: Target) => {
  const [row] = plan.resources;
  if (
    plan.stack.name !== target.stack ||
    plan.stack.stage !== "prod" ||
    plan.actions.length !== 0 ||
    Object.keys(plan.native.actions).length !== 0 ||
    Object.values(plan.native.actionDeletions).some(
      (node) => node !== undefined
    ) ||
    Object.values(plan.native.deletions).some((node) => node !== undefined) ||
    Object.keys(plan.native.resources).length !== 1 ||
    plan.resources.length !== 1 ||
    !row ||
    row.fqn !== target.stack ||
    row.logicalId !== target.stack ||
    row.resourceType !== "Cloudflare.Worker" ||
    row.providerMode === "local" ||
    (row.action !== "update" && row.action !== "noop") ||
    row.bindings.some((binding) => binding.action !== "noop")
  ) {
    throw new Error(
      "Expected one existing production Worker with only a code update or no-op and no binding changes."
    );
  }
  return row;
};

export const requireSafePlan = (
  plan: ReleasePlan,
  target: Target,
  accountId: string
) => {
  const row = requireWorkerRow(plan, target);
  const resource = Schema.decodeUnknownSync(ExistingOwner)(
    plan.native.resources[row.fqn]
  );
  if (
    resource.action !== row.action ||
    resource.renamedFrom?.length ||
    resource.adopting
  ) {
    throw new Error(
      "Production Worker ownership is missing, unsettled, or subject to migration."
    );
  }
  const { attr } = resource.state;
  if (
    attr.accountId !== accountId ||
    attr.workerName !== target.worker ||
    !exactNames(Object.keys(attr.durableObjectNamespaces), [
      target.namespaceBinding,
    ]) ||
    attr.durableObjectNamespaces[target.namespaceBinding] !==
      target.namespaceId ||
    !exactNames(attr.secretNames, target.secretNames)
  ) {
    throw new Error(
      "Persisted production Worker, namespace, or secret names do not match the approved release target."
    );
  }
  return row.action;
};

export const LiveSettings = Schema.Struct({
  result: Schema.Struct({
    bindings: Schema.Array(
      Schema.Struct({
        class_name: Schema.optional(Schema.String),
        name: Schema.String,
        namespace_id: Schema.optional(Schema.String),
        type: Schema.String,
      })
    ),
  }),
  success: Schema.Literal(true),
});

export const requireLiveBindings = (
  { result }: typeof LiveSettings.Type,
  target: Target
) => {
  const secretBindings = result.bindings.filter(
    ({ type }) => type === "secret_text" || type === "secret_key"
  );
  const objects = result.bindings.filter(
    ({ type }) => type === "durable_object_namespace"
  );
  const [object] = objects;
  if (
    secretBindings.some(({ type }) => type !== "secret_text") ||
    !exactNames(
      secretBindings.map(({ name }) => name),
      target.secretNames
    ) ||
    objects.length !== 1 ||
    object?.name !== target.namespaceBinding ||
    object.class_name !== target.namespaceBinding ||
    object.namespace_id !== target.namespaceId
  ) {
    throw new Error(
      "Live production secret bindings or Durable Object identity are not as expected."
    );
  }
};
