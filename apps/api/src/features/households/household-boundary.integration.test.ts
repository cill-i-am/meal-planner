import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  CreateMealPlanPayload,
  HouseholdAdultInvitationResult,
  HouseholdMemberDepartureOperation,
  HouseholdMealPlanResponse,
  HouseholdPeopleRoster,
  HouseholdPerson,
  PersonProfile,
} from "@meal-planner/household-api";
import {
  DirectoryFrame,
  MAX_PRIVATE_FRAME_BYTES,
  ProfileCard,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import {
  Recipe,
  RecipeImportAction,
  RecipeImportBatch,
  RecipeImportIntent,
  RecipeImportTimeline,
} from "@meal-planner/recipe-import-api";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";
import * as authSchema from "../auth/auth.database-schema.js";
import {
  privateOutputControlWorker,
  privateOutputRuntimeWorker,
  privateOutputTestBindings,
} from "../private-output/private-output-runtime.test-fixture.js";
import {
  PrivateParticipantBinding,
  privateOutputKey,
} from "../private-output/private-output.contract.js";
import { makeProviderAccountingDatabase } from "../provider-accounting/provider-accounting.database.js";
import {
  ProviderAccountingDispatchId,
  ProviderAccountingProviderStageId,
  ProviderAccountingRunId,
  ProviderAccountingTimestamp,
} from "../provider-accounting/provider-accounting.js";
import { makeD1ProviderAccountingRepository } from "../provider-accounting/provider-accounting.repository.d1.js";
import {
  HouseholdClaimAcquisitionAttemptResult,
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadAcquisitionAttemptsResult,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageResult,
  HouseholdReadImportTerminalCheckpointResult,
  HouseholdReadRecipeRecoveryAttemptResult,
} from "./evidence/household-evidence.contract.js";
import { HouseholdMetadata } from "./household.contract.js";
import { MemberDepartureWorkflowInput } from "./people/member-departure.js";

// Native integration cases include auth, durable writes, and persisted-runtime restarts.
vi.setConfig({ testTimeout: 30_000 });

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
const secret = "local-boundary-test-secret-at-least-32-characters";
const temporaryDirectories: string[] = [];
let runtime: Miniflare | undefined;
let persistenceDirectory = "";
let websiteManifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;
let apiManifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;
let domainManifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;
let providerRecoveryManifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;
let batchQueueManifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;

const getRuntime = (): Miniflare => {
  if (runtime === undefined) {
    throw new Error("Expected the household boundary runtime to be ready.");
  }
  return runtime;
};

const HouseholdStatusResponse = Schema.Struct({
  ...HouseholdMetadata.fields,
  status: Schema.Literal("ready"),
});
const SessionResponse = Schema.Struct({
  session: Schema.Struct({ id: Schema.String }),
  user: Schema.Struct({ id: Schema.String }),
});
const OrganizationResponse = Schema.Struct({ id: Schema.String });
const createPayload = Schema.decodeUnknownSync(CreateMealPlanPayload)({
  policy: {
    allowedDietaryFit: ["household_match"],
    allowedDifficulties: ["easy"],
    allowedTotalTimeBands: ["under_30_minutes"],
    maxRecipeUses: 1,
    preferredCuisines: ["Irish"],
    version: "boundary-policy-v1",
  },
  request: {
    requestKey: "boundary-week",
    slots: [
      {
        date: "2026-08-24",
        mealType: "dinner",
        servings: 2,
        slotId: "boundary-dinner",
      },
    ],
  },
});

type MiniflareD1Database = Awaited<ReturnType<Miniflare["getD1Database"]>>;

const applyD1Migrations = async (
  database: MiniflareD1Database,
  migrationsDirectory: "auth-migrations" | "provider-accounting-migrations"
) => {
  const migrationsRoot = fileURLToPath(
    new URL(`../../../${migrationsDirectory}`, import.meta.url)
  );
  const migrationDirectories = await readdir(migrationsRoot);
  const directories = migrationDirectories.toSorted();
  const migrations = await Promise.all(
    directories.map(async (directory) => {
      const migrationPath = `${migrationsRoot}/${directory}/migration.sql`;
      const migrationStats = await stat(migrationPath);
      if (!migrationStats.isFile()) {
        return [];
      }
      const migrationContents = await readFile(migrationPath, "utf-8");
      return migrationContents
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
    })
  );
  await database.batch(
    migrations.flat().map((statement) => database.prepare(statement))
  );
};

let privateOutputControlManifest: Awaited<
  ReturnType<typeof bundleWorkerFixture>
>;
let privateOutputManifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;

const makeRuntime = (privateAuditLogs?: string[]) =>
  new Miniflare({
    cf: false,
    handleStructuredLogs:
      privateAuditLogs === undefined
        ? undefined
        : (entry) => {
            privateAuditLogs.push(entry.message);
          },
    resourcePersistencePath: persistenceDirectory,
    unsafeInspectDurableObjects: true,
    workers: [
      {
        config: {
          compatibilityDate,
          compatibilityFlags,
          env: { MEAL_PLANNER_API: { type: "worker", worker: "api" } },
          manifest: websiteManifest,
          name: "website",
          type: "worker",
        },
      },
      {
        config: {
          compatibilityDate,
          compatibilityFlags,
          env: {
            ...privateOutputTestBindings,
            BETTER_AUTH_SECRET: { type: "text", value: secret },
            HOUSEHOLD_TEST_OBSERVATIONS: {
              id: "HOUSEHOLD_TEST_OBSERVATIONS",
              type: "kv",
            },
            HouseholdDomainWorker: {
              type: "worker",
              worker: "household-domain",
            },
            MealPlannerAuthDatabase: { id: "household-auth-test", type: "d1" },
            MemberDepartureTestWorkflow: {
              exportName: "MemberDepartureTestWorkflow",
              name: "member-departure-test-workflow",
              type: "workflow",
              worker: "api",
            },
            ProviderAccountingDatabase: {
              id: "provider-accounting-test",
              type: "d1",
            },
          },
          manifest: apiManifest,
          name: "api",
          type: "worker",
        },
      },
      {
        config: {
          compatibilityDate,
          compatibilityFlags,
          env: {
            BATCH_QUEUE_RESULTS: { id: "BATCH_QUEUE_RESULTS", type: "kv" },
          },
          manifest: batchQueueManifest,
          name: "batch-consumer",
          triggers: [{ name: "household-import-batches", type: "queue" }],
          type: "worker",
        },
      },
      {
        config: {
          compatibilityDate,
          compatibilityFlags,
          env: {
            ...privateOutputTestBindings,
            HouseholdImportBatchQueue: {
              name: "household-import-batches",
              type: "queue",
            },
            HouseholdObject: {
              exportName: "HouseholdObject",
              type: "durable-object",
              worker: "household-domain",
            },
          },
          exports: {
            HouseholdObject: { storage: "sqlite", type: "durable-object" },
          },
          manifest: domainManifest,
          name: "household-domain",
          type: "worker",
        },
      },
      {
        config: {
          compatibilityDate,
          compatibilityFlags,
          env: {
            HouseholdDomainWorker: {
              type: "worker",
              worker: "household-domain",
            },
            ImportEvidenceBucket: { name: "ImportEvidenceBucket", type: "r2" },
            PROVIDER_RECOVERY_RESULTS: {
              id: "PROVIDER_RECOVERY_RESULTS",
              type: "kv",
            },
            ProviderAccountingDatabase: {
              id: "provider-accounting-test",
              type: "d1",
            },
          },
          manifest: providerRecoveryManifest,
          name: "provider-recovery",
          type: "worker",
        },
      },
      privateOutputRuntimeWorker(privateOutputControlManifest),
      privateOutputControlWorker(privateOutputControlManifest),
      {
        config: {
          ...privateOutputRuntimeWorker(privateOutputManifest).config,
          name: "private-output-public",
        },
      },
    ],
  });

const restartRuntime = async (privateAuditLogs?: string[]) => {
  await runtime?.dispose();
  runtime = makeRuntime(privateAuditLogs);
};

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-household-boundary-`
  );
  temporaryDirectories.push(temporaryDirectory);
  privateOutputControlManifest = await bundleWorkerFixture(
    fileURLToPath(
      new URL(
        "../private-output/private-output-control.test-fixture.ts",
        import.meta.url
      )
    ),
    temporaryDirectory
  );
  privateOutputManifest = await bundleWorkerFixture(
    fileURLToPath(
      new URL("../private-output/private-output-worker.ts", import.meta.url)
    ),
    temporaryDirectory
  );
  persistenceDirectory = `${temporaryDirectory}/runtime-storage`;
  [
    websiteManifest,
    apiManifest,
    domainManifest,
    providerRecoveryManifest,
    batchQueueManifest,
  ] = await Promise.all([
    bundleWorkerFixture(
      fileURLToPath(
        new URL("household-website-service.test-fixture.js", import.meta.url)
      ),
      temporaryDirectory
    ),
    bundleWorkerFixture(
      fileURLToPath(
        new URL("household-api-service.test-fixture.ts", import.meta.url)
      ),
      temporaryDirectory
    ),
    bundleWorkerFixture(
      fileURLToPath(
        new URL("household-domain-service.test-fixture.js", import.meta.url)
      ),
      temporaryDirectory
    ),
    bundleWorkerFixture(
      fileURLToPath(
        new URL("household-provider-recovery.test-fixture.ts", import.meta.url)
      ),
      temporaryDirectory
    ),
    bundleWorkerFixture(
      fileURLToPath(
        new URL("household-import-batch-queue.test-fixture.ts", import.meta.url)
      ),
      temporaryDirectory
    ),
  ]);
  runtime = makeRuntime();
  await Promise.all([
    applyD1Migrations(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api"),
      "auth-migrations"
    ),
    applyD1Migrations(
      await getRuntime().getD1Database(
        "ProviderAccountingDatabase",
        "provider-recovery"
      ),
      "provider-accounting-migrations"
    ),
  ]);
}, 30_000);

afterAll(async () => {
  await runtime?.dispose();
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

const cookieHeader = (response: {
  readonly headers: { readonly get: (name: string) => string | null };
}): string => {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) {
    throw new Error("Expected Better Auth to set a session cookie.");
  }
  return setCookie.split(";", 1)[0] ?? "";
};

const authRequest = (
  path: string,
  body: Record<string, unknown>,
  cookie?: string
) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: "https://meal-planner.test",
  };
  if (cookie !== undefined) {
    headers["cookie"] = cookie;
  }
  return getRuntime().dispatchFetch(
    `https://meal-planner.test/api/auth${path}`,
    { body: JSON.stringify(body), headers, method: "POST" }
  );
};

const signUp = async (label: string) => {
  const response = await authRequest("/sign-up/email", {
    email: `${label.toLowerCase().replaceAll(" ", "-")}@example.test`,
    name: label,
    password: "correct horse battery staple",
  });
  expect(response.status).toBe(200);
  return cookieHeader(response);
};

const getSession = async (cookie: string) => {
  const response = await getRuntime().dispatchFetch(
    "https://meal-planner.test/api/auth/get-session",
    { headers: { cookie } }
  );
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(SessionResponse)(await response.json());
};

const signIn = async (label: string) => {
  const response = await authRequest("/sign-in/email", {
    email: `${label.toLowerCase().replaceAll(" ", "-")}@example.test`,
    password: "correct horse battery staple",
  });
  expect(response.status).toBe(200);
  return cookieHeader(response);
};

const createOrganization = async (label: string, cookie: string) => {
  const response = await authRequest(
    "/organization/create",
    { name: label, slug: label.toLowerCase().replaceAll(" ", "-") },
    cookie
  );
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(OrganizationResponse)(
    await response.json()
  );
};

const prepareInvitableAdult = async (label: string) => {
  const key = label.toLowerCase().replaceAll(" ", "-");
  const ownerCookie = await signUp(`${label} Owner`);
  const organization = await createOrganization(
    `${label} Household`,
    ownerCookie
  );
  const bootstrap = await getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/household/people/bootstrap-creator",
    {
      body: JSON.stringify({
        displayName: `${label} Owner`,
        mutationId: `${key}-bootstrap`,
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    }
  );
  expect(bootstrap.status, await bootstrap.clone().text()).toBe(200);
  const adultResponse = await getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/household/people",
    {
      body: JSON.stringify({
        displayName: `${label} Adult`,
        kind: "adult",
        mutationId: `${key}-create-adult`,
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    }
  );
  expect(adultResponse.status, await adultResponse.clone().text()).toBe(201);
  return {
    adult: await Schema.decodeUnknownPromise(HouseholdPerson)(
      await adultResponse.json()
    ),
    organization,
    ownerCookie,
  } as const;
};

const prepareLinkedAdult = async (
  label: string,
  existingInvitee?: { readonly cookie: string; readonly label: string }
) => {
  const key = label.toLowerCase().replaceAll(" ", "-");
  const ownerLabel = `${label} Owner`;
  const invitedLabel = existingInvitee?.label ?? `${label} Adult`;
  const initialOwnerCookie = await signUp(ownerLabel);
  const organization = await createOrganization(
    `${label} Household`,
    initialOwnerCookie
  );
  const activeOwner = await authRequest(
    "/organization/set-active",
    { organizationId: organization.id },
    initialOwnerCookie
  );
  expect(activeOwner.status, await activeOwner.clone().text()).toBe(200);
  const ownerCookie =
    activeOwner.headers.get("set-cookie") === null
      ? initialOwnerCookie
      : cookieHeader(activeOwner);
  const bootstrap = await getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/household/people/bootstrap-creator",
    {
      body: JSON.stringify({
        displayName: ownerLabel,
        mutationId: `${key}-bootstrap`,
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    }
  );
  expect(bootstrap.status, await bootstrap.clone().text()).toBe(200);
  const adultResponse = await getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/household/people",
    {
      body: JSON.stringify({
        displayName: invitedLabel,
        kind: "adult",
        mutationId: `${key}-create-adult`,
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    }
  );
  expect(adultResponse.status, await adultResponse.clone().text()).toBe(201);
  const adult = await Schema.decodeUnknownPromise(HouseholdPerson)(
    await adultResponse.json()
  );
  const invitedCookie = existingInvitee?.cookie ?? (await signUp(invitedLabel));
  const invitationResponse = await getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/household/people/invitations",
    {
      body: JSON.stringify({
        email: `${invitedLabel.toLowerCase().replaceAll(" ", "-")}@example.test`,
        mutationId: `${key}-invite`,
        personId: adult.id,
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    }
  );
  expect(
    invitationResponse.status,
    await invitationResponse.clone().text()
  ).toBe(201);
  const invitation = await Schema.decodeUnknownPromise(
    HouseholdAdultInvitationResult
  )(await invitationResponse.json());
  const acceptance = await authRequest(
    "/organization/accept-invitation",
    { invitationId: invitation.invitationId },
    invitedCookie
  );
  expect(acceptance.status, await acceptance.clone().text()).toBe(200);
  const active = await authRequest(
    "/organization/set-active",
    { organizationId: organization.id },
    invitedCookie
  );
  expect(active.status, await active.clone().text()).toBe(200);
  const memberCookie =
    active.headers.get("set-cookie") === null
      ? invitedCookie
      : cookieHeader(active);
  const link = await getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/household/people/links/complete",
    {
      body: JSON.stringify({
        invitationId: invitation.invitationId,
        mutationId: `${key}-link`,
      }),
      headers: { "content-type": "application/json", cookie: memberCookie },
      method: "POST",
    }
  );
  expect(link.status, await link.clone().text()).toBe(200);
  const linked = await Schema.decodeUnknownPromise(HouseholdPerson)(
    await link.json()
  );
  const session = await getSession(memberCookie);
  const database = drizzle(
    await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
  );
  const [membership] = await database
    .select({ id: authSchema.member.id })
    .from(authSchema.member)
    .where(
      and(
        eq(authSchema.member.organizationId, organization.id),
        eq(authSchema.member.userId, session.user.id)
      )
    )
    .limit(1);
  if (membership === undefined) {
    throw new Error("Expected accepted adult membership");
  }
  return {
    adult: linked,
    invitationId: invitation.invitationId,
    memberCookie,
    memberId: membership.id,
    organization,
    ownerCookie,
  } as const;
};

const readDepartureWorkflowInput = async (
  organizationId: string,
  remaining = 40
): Promise<typeof MemberDepartureWorkflowInput.Type> => {
  const bindings = await getRuntime().getBindings<{
    readonly HOUSEHOLD_TEST_OBSERVATIONS: {
      readonly get: (key: string) => Promise<string | null>;
    };
  }>("api");
  const value = await bindings.HOUSEHOLD_TEST_OBSERVATIONS.get(
    `member-departure-workflow:${organizationId}`
  );
  if (value !== null) {
    return Schema.decodeUnknownPromise(MemberDepartureWorkflowInput)(
      JSON.parse(value)
    );
  }
  if (remaining === 0) {
    throw new Error("Expected the member departure Workflow to start");
  }
  await delay(50);
  return readDepartureWorkflowInput(organizationId, remaining - 1);
};

const readDepartureEventually = async (
  cookie: string,
  operationId: string,
  expectedState: (typeof HouseholdMemberDepartureOperation.Type)["state"],
  remaining = 60
): Promise<typeof HouseholdMemberDepartureOperation.Type> => {
  let observedState = "unreadable";
  const response = await getRuntime().dispatchFetch(
    `https://meal-planner.test/v1/household/people/departures/${operationId}`,
    { headers: { cookie } }
  );
  if (response.status !== 200) {
    throw new Error(
      `Departure read returned ${response.status}: ${await response.text()}`
    );
  }
  if (response.status === 200) {
    const operation = await Schema.decodeUnknownPromise(
      HouseholdMemberDepartureOperation
    )(await response.json());
    observedState = operation.state;
    if (operation.state === expectedState) {
      return operation;
    }
  }
  if (remaining === 0) {
    throw new Error(
      `Expected departure state ${expectedState}; last observed ${observedState}`
    );
  }
  await delay(100);
  return readDepartureEventually(
    cookie,
    operationId,
    expectedState,
    remaining - 1
  );
};

const readDepartureByMutationEventually = async (
  cookie: string,
  mutationId: string,
  expectedState: (typeof HouseholdMemberDepartureOperation.Type)["state"],
  remaining = 60
): Promise<typeof HouseholdMemberDepartureOperation.Type> => {
  const response = await getRuntime().dispatchFetch(
    `https://meal-planner.test/v1/household/people/departures/by-mutation/${mutationId}`,
    { headers: { cookie } }
  );
  if (response.status !== 200) {
    throw new Error(
      `Departure recovery returned ${response.status}: ${await response.text()}`
    );
  }
  const operation = await Schema.decodeUnknownPromise(
    HouseholdMemberDepartureOperation
  )(await response.json());
  if (operation.state === expectedState) {
    return operation;
  }
  if (remaining === 0) {
    throw new Error(
      `Expected recovered departure state ${expectedState}; last observed ${operation.state}`
    );
  }
  await delay(100);
  return readDepartureByMutationEventually(
    cookie,
    mutationId,
    expectedState,
    remaining - 1
  );
};

const systemCommand = (
  ...[operation, input]:
    | [
        operation: "commit-acquisition-evidence" | "mutate-evidence-stage",
        input: {
          readonly acquisitionAttemptGeneration: number;
          readonly [field: string]: unknown;
        },
      ]
    | [
        operation:
          | "claim-acquisition-attempt"
          | "claim-batch-item"
          | "complete-batch-item"
          | "commit-draft"
          | "fail-batch-item"
          | "observe-evidence-reference"
          | "prepare-recipe-recovery"
          | "read-acquisition-attempts"
          | "read-evidence-references"
          | "read-evidence-stage"
          | "read-terminal-checkpoint"
          | "read-recipe-recovery-attempt"
          | "resolve"
          | "transition-lifecycle",
        input: object,
      ]
) =>
  getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/__test/system-import",
    {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        "x-test-household-system-operation": operation,
      },
      method: "POST",
    }
  );

const terminalSettlementCommand = async (
  input: object,
  options?: {
    readonly speechRestart?: "fail" | "lose-response" | "terminal-then-fail";
  }
) => {
  const worker = await getRuntime().getWorker("provider-recovery");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-test-terminal-settlement": "1",
  };
  if (options?.speechRestart !== undefined) {
    headers["x-test-speech-restart"] = options.speechRestart;
  }
  return worker.fetch("https://provider-recovery.test/terminal-settlement", {
    body: JSON.stringify(input),
    headers,
    method: "POST",
  });
};

const providerTerminalAttemptCommand = async (input: object) => {
  const worker = await getRuntime().getWorker("provider-recovery");
  return worker.fetch("https://provider-recovery.test/provider-terminal", {
    body: JSON.stringify(input),
    headers: {
      "content-type": "application/json",
      "x-test-provider-terminal-attempt": "1",
    },
    method: "POST",
  });
};

const visualResumeCommand = async (input: object) => {
  const worker = await getRuntime().getWorker("provider-recovery");
  return worker.fetch("https://provider-recovery.test/visual-resume", {
    body: JSON.stringify(input),
    headers: {
      "content-type": "application/json",
      "x-test-visual-resume": "1",
    },
    method: "POST",
  });
};

const dispatchTraceDurabilityCommand = async (input: object) => {
  const worker = await getRuntime().getWorker("provider-recovery");
  return worker.fetch("https://provider-recovery.test/dispatch-trace", {
    body: JSON.stringify(input),
    headers: {
      "content-type": "application/json",
      "x-test-dispatch-trace-durability": "1",
    },
    method: "POST",
  });
};

const settleUnknownProviderBudget = async (input: {
  readonly dispatchId: string;
  readonly importId: string;
  readonly providerStageId: "speech-transcription" | "visual-evidence";
}) => {
  const database = await getRuntime().getD1Database(
    "ProviderAccountingDatabase",
    "provider-recovery"
  );
  const budget = makeD1ProviderAccountingRepository(
    makeProviderAccountingDatabase(database)
  );
  const reservation = {
    dispatchId: Schema.decodeUnknownSync(ProviderAccountingDispatchId)(
      input.dispatchId
    ),
    maximumCostMicroUsd: 50_000,
    providerStageId: Schema.decodeUnknownSync(
      ProviderAccountingProviderStageId
    )(input.providerStageId),
    runId: Schema.decodeUnknownSync(ProviderAccountingRunId)(
      `recipe-import:${input.importId}`
    ),
    timestamp: Schema.decodeUnknownSync(ProviderAccountingTimestamp)(
      new Date().toISOString()
    ),
  };
  await Effect.runPromise(budget.reserve(reservation));
  const claim = await Effect.runPromise(budget.beginInvocation(reservation));
  if (claim._tag !== "Claimed") {
    throw new Error("expected provider invocation claim");
  }
  await Effect.runPromise(
    budget.settleUnknown({
      ...reservation,
      invocationGeneration: claim.dispatch.invocationGeneration,
    })
  );
};

const batchQueueResult = async (
  itemId: string,
  remaining = 80
): Promise<unknown> => {
  const results = await getRuntime().getKVNamespace(
    "BATCH_QUEUE_RESULTS",
    "batch-consumer"
  );
  const value = await results.get(itemId, "json");
  if (value !== null) {
    return value;
  }
  if (remaining === 0) {
    throw new Error("Batch outbox alarm was not delivered.");
  }
  await delay(25);
  return batchQueueResult(itemId, remaining - 1);
};

const batchQueueDeliveries = async (itemId: string) => {
  const results = await getRuntime().getKVNamespace(
    "BATCH_QUEUE_RESULTS",
    "batch-consumer"
  );
  return Number((await results.get(`${itemId}:deliveries`)) ?? "0");
};

const readEvidenceReferences = async (
  admission: object,
  intentId: string,
  expectedGeneration = 1
) => {
  const response = await systemCommand("read-evidence-references", {
    admission,
    expectedGeneration,
    intentId,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return Schema.decodeUnknownPromise(HouseholdReadEvidenceReferencesResult)(
    await response.json()
  );
};

const evidenceRetentionResult = (input: {
  readonly acquiredAt: Date;
  readonly generation: number;
  readonly intentId: string;
}) => {
  const deleteAt = new Date(input.acquiredAt.getTime() + 604_800_000);
  return {
    acquiredAt: input.acquiredAt.toISOString(),
    audioStreams: [{ codec: "aac", index: 0 }],
    durationSeconds: 20,
    references: [
      {
        byteLength: 4096,
        deleteAt: deleteAt.toISOString(),
        key: `imports/${input.intentId}/acquisition/v1/generations/${input.generation}/original.mp4`,
        kind: "original_media",
        sha256: "7".repeat(64),
      },
      {
        byteLength: 512,
        deleteAt: deleteAt.toISOString(),
        key: `imports/${input.intentId}/acquisition/v1/generations/${input.generation}/manifest.json`,
        kind: "acquisition_manifest",
        sha256: "8".repeat(64),
      },
    ],
    videoStreams: [{ codec: "h264", index: 0 }],
  } as const;
};

const admitResolvedEvidenceImport = async (input: {
  readonly acquisitionAttempts?: number;
  readonly canonicalSourceId?: string;
  readonly label: string;
  readonly mutationId: string;
  readonly sourceKind?: "carousel" | "video";
  readonly videoId: string;
}) => {
  const cookie = await signUp(input.label);
  const organization = await createOrganization(
    `${input.label} Household`,
    cookie
  );
  const createResponse = await getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/recipe-import-intents",
    {
      body: JSON.stringify({
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@mealplanner/video/${input.videoId}`,
        },
      }),
      headers: {
        "content-type": "application/json",
        cookie,
        "idempotency-key": `evidence-${input.videoId}`,
      },
      method: "POST",
    }
  );
  expect(createResponse.status).toBe(201);
  const admitted = await Schema.decodeUnknownPromise(RecipeImportIntent)(
    await createResponse.json()
  );
  const admission = {
    actor: { _tag: "System", purpose: "recipe_import_lifecycle_commit" },
    organizationId: organization.id,
  } as const;
  const resolvedResponse = await systemCommand("resolve", {
    admission,
    canonicalSourceId:
      input.canonicalSourceId ?? `tiktok:video:${input.videoId}`,
    canonicalUrl: `https://www.tiktok.com/@mealplanner/video/${input.videoId}`,
    expectedGeneration: 1,
    intentId: admitted.id,
    mutationId: input.mutationId,
    sourceKind: input.sourceKind ?? "video",
  });
  expect(resolvedResponse.status, await resolvedResponse.text()).toBe(200);
  const acquisitionAttempts =
    input.sourceKind === "carousel" ? 0 : (input.acquisitionAttempts ?? 1);
  for (
    let attemptOrdinal = 1;
    attemptOrdinal <= acquisitionAttempts;
    attemptOrdinal += 1
  ) {
    // eslint-disable-next-line no-await-in-loop -- The household ledger requires each ordinal to commit before the next claim.
    const claimed = await systemCommand("claim-acquisition-attempt", {
      admission,
      attemptIdentity: attemptOrdinal.toString(16).repeat(64),
      attemptOrdinal,
      canonicalSourceId:
        input.canonicalSourceId ?? `tiktok:video:${input.videoId}`,
      expectedGeneration: 1,
      intentId: admitted.id,
    });
    // eslint-disable-next-line no-await-in-loop -- Read the response before advancing the sequential claim ledger.
    expect(claimed.status, await claimed.clone().text()).toBe(200);
  }
  return { admission, admitted, cookie, organization } as const;
};

const readSpeechStage = async (input: {
  readonly admission: object;
  readonly generation: number;
  readonly intentId: string;
}) => {
  const response = await systemCommand("read-evidence-stage", {
    admission: input.admission,
    expectedGeneration: input.generation,
    intentId: input.intentId,
    stage: "speech",
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return Schema.decodeUnknownPromise(HouseholdReadEvidenceStageResult)(
    await response.json()
  );
};

const prepareUnknownSpeechTerminal = async (input: {
  readonly acquisitionGeneration?: number;
  readonly label: string;
  readonly mutationIds: readonly [resolve: string, claim: string, fail: string];
  readonly videoId: string;
}) => {
  const { admission, admitted, organization } =
    await admitResolvedEvidenceImport({
      acquisitionAttempts: input.acquisitionGeneration ?? 1,
      label: input.label,
      mutationId: input.mutationIds[0],
      videoId: input.videoId,
    });
  const executionGeneration = 1;
  const acquisitionGeneration = input.acquisitionGeneration ?? 1;
  const acquisition = evidenceRetentionResult({
    acquiredAt: new Date(Date.now() + 60_000),
    generation: acquisitionGeneration,
    intentId: admitted.id,
  });
  const committed = await systemCommand("commit-acquisition-evidence", {
    acquisitionAttemptGeneration: acquisitionGeneration,
    admission,
    expectedGeneration: executionGeneration,
    intentId: admitted.id,
    mutationId: input.mutationIds[1],
    result: acquisition,
  });
  expect(committed.status, await committed.clone().text()).toBe(200);
  const inputFingerprint = "2".repeat(64);
  const dispatchId = `speech:${admitted.id}:${acquisitionGeneration}`;
  const terminal = await providerTerminalAttemptCommand({
    acquisitionGeneration,
    admission,
    canonicalSourceId: `tiktok:video:${input.videoId}`,
    correlationId: "00000000-0000-4000-8000-000000000188",
    dispatchId,
    executionGeneration,
    inputFingerprint,
    intentId: admitted.id,
    stage: "speech",
  });
  expect(terminal.status, await terminal.clone().text()).toBe(200);
  const terminalStage = await readSpeechStage({
    admission,
    generation: executionGeneration,
    intentId: admitted.id,
  });
  expect(terminalStage).toMatchObject({
    dispatchId,
    failureCode: "outcome_unknown",
    inputFingerprint,
    outcome: "Failed",
  });
  if (terminalStage === null) {
    throw new Error("Expected household speech terminal authority.");
  }
  const terminalCheckpoint = await systemCommand("read-terminal-checkpoint", {
    admission,
    expectedGeneration: executionGeneration,
    intentId: admitted.id,
    ownershipId: terminalStage.dispatchId,
    stage: "speech",
  });
  expect(
    terminalCheckpoint.status,
    await terminalCheckpoint.clone().text()
  ).toBe(200);
  expect(await terminalCheckpoint.json()).toMatchObject({
    failureCode: "outcome_unknown",
    ownershipId: dispatchId,
    stage: "speech",
  });

  await settleUnknownProviderBudget({
    dispatchId,
    importId: admitted.id,
    providerStageId: "speech-transcription",
  });
  const settled = await terminalSettlementCommand({
    dispatchId,
    importId: admitted.id,
    operation: "settle_speech_unknown",
  });
  expect(settled.status, await settled.clone().text()).toBe(200);

  return {
    acquisitionGeneration,
    admission,
    canonicalSourceId: `tiktok:video:${input.videoId}`,
    dispatchId,
    executionGeneration,
    generation: executionGeneration,
    inputFingerprint,
    intentId: admitted.id,
    organizationId: organization.id,
    recoveryCommand: {
      acquisitionGeneration,
      dispatchId,
      executionGeneration,
      importId: admitted.id,
      operation: "prepare_speech_recovery",
      organizationId: organization.id,
    } as const,
    recoveryDispatchId: `${dispatchId}:recovery:1`,
  } as const;
};

const review = {
  answers: [],
  blockers: { invalidFields: [], unresolvedRequiredFields: [] },
  editableFields: ["name", "ingredient_lines", "instructions", "tags"],
  recipe: {
    author: null,
    category: null,
    cookTimeMinutes: 15,
    cuisine: "Irish",
    description: "Provider-free public boundary tracer.",
    ingredientLines: ["1 local ingredient"],
    ingredientQuantities: null,
    ingredientUnits: null,
    instructions: ["Cook locally."],
    name: "Public household tracer stew",
    nutrition: null,
    prepTimeMinutes: 10,
    temperatureCelsius: null,
    tools: ["Pot"],
    totalTimeMinutes: 25,
    yield: "2 servings",
  },
  tags: {
    cuisines: ["Irish"],
    dietaryFit: "household_match",
    difficulty: "easy",
    leftovers: "one_meal",
    mealTypes: ["dinner"],
    totalTimeBand: "under_30_minutes",
  },
} as const;

describe("household public API to private Durable Object boundary", () => {
  it("records and confirms a dependant profile without inventing a dependant account", async () => {
    const { ownerCookie } = await prepareInvitableAdult("Dependant Profile");
    const headers = { "content-type": "application/json", cookie: ownerCookie };
    const created = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      {
        body: JSON.stringify({
          displayName: "Child",
          kind: "dependant",
          mutationId: "profile-child",
        }),
        headers,
        method: "POST",
      }
    );
    expect(created.status).toBe(201);
    const person = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await created.json()
    );
    const url = `https://meal-planner.test/v1/household/people/${person.id}/profile`;
    const provisional = await getRuntime().dispatchFetch(url, {
      body: JSON.stringify({
        command: {
          _tag: "AddProvisionalProfileFact",
          fact: {
            _tag: "FoodPreference",
            label: "Carrots",
            sentiment: "like",
            targetKind: "ingredient",
          },
        },
        expectedProfileVersion: 0,
        mutationId: "profile-child-provisional",
      }),
      headers,
      method: "POST",
    });
    expect(provisional.status).toBe(200);
    const first = await Schema.decodeUnknownPromise(PersonProfile)(
      await provisional.json()
    );
    const [fact] = first.facts;
    if (fact === undefined) {
      throw new Error("Expected the child's provisional fact.");
    }
    const confirmed = await getRuntime().dispatchFetch(url, {
      body: JSON.stringify({
        command: {
          _tag: "ConfirmProfileFact",
          basis: "household_adult",
          factId: fact.id,
        },
        expectedProfileVersion: 1,
        mutationId: "profile-child-confirm",
      }),
      headers,
      method: "POST",
    });
    expect(confirmed.status).toBe(200);
    const second = await Schema.decodeUnknownPromise(PersonProfile)(
      await confirmed.json()
    );
    expect(second.facts[0]).toMatchObject({
      id: fact.id,
      standing: { _tag: "confirmed", basis: "household_adult" },
    });
    expect(second.audit?.before).toMatchObject({
      standing: { _tag: "provisional" },
    });
    expect(second.audit?.after).toMatchObject({
      id: fact.id,
      standing: { _tag: "confirmed" },
    });
  });

  it("serializes person archival with a profile mutation without losing history", async () => {
    const { adult, ownerCookie } = await prepareInvitableAdult(
      "Profile Archive Race"
    );
    const base = `https://meal-planner.test/v1/household/people/${adult.id}`;
    const headers = { "content-type": "application/json", cookie: ownerCookie };
    const [archive, mutation] = await Promise.all([
      getRuntime().dispatchFetch(`${base}/archive`, {
        body: JSON.stringify({
          expectedVersion: adult.version,
          mutationId: "profile-archive-race",
        }),
        headers,
        method: "POST",
      }),
      getRuntime().dispatchFetch(`${base}/profile`, {
        body: JSON.stringify({
          command: {
            _tag: "AddProvisionalProfileFact",
            fact: {
              _tag: "FoodPreference",
              label: "Carrots",
              sentiment: "like",
              targetKind: "ingredient",
            },
          },
          expectedProfileVersion: 0,
          mutationId: "profile-racing-write",
        }),
        headers,
        method: "POST",
      }),
    ]);
    expect(archive.status, await archive.clone().text()).toBe(200);
    expect([200, 409]).toContain(mutation.status);
    const current = await getRuntime().dispatchFetch(`${base}/profile`, {
      headers,
    });
    const profile = await Schema.decodeUnknownPromise(PersonProfile)(
      await current.json()
    );
    expect(profile.version).toBe(mutation.status === 200 ? 1 : 0);
    if (mutation.status === 409) {
      expect(await mutation.json()).toMatchObject({ code: "person_archived" });
    }
    const history = await getRuntime().dispatchFetch(
      `${base}/profile/versions`,
      { headers }
    );
    expect(await history.json()).toMatchObject({
      versions:
        profile.version === 0
          ? []
          : [Schema.encodeSync(PersonProfile)(profile)],
    });
    const unauthorized = await getRuntime().dispatchFetch(`${base}/profile`);
    expect(unauthorized.status).toBe(401);
  });

  it("fences profile safety, concurrent adult edits, and durable history by household", async () => {
    const setup = await prepareLinkedAdult("Profile Safety Runtime");
    const url = `https://meal-planner.test/v1/household/people/${setup.adult.id}/profile`;
    const post = (cookie: string, payload: object) =>
      getRuntime().dispatchFetch(url, {
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      });
    const initial = await post(setup.ownerCookie, {
      command: {
        _tag: "AddProvisionalProfileFact",
        fact: {
          _tag: "HardConstraint",
          category: "allergen",
          handling: "exclude",
          label: "Peanuts",
        },
      },
      expectedProfileVersion: 0,
      mutationId: "profile-safety-initial",
    });
    expect(initial.status, await initial.clone().text()).toBe(200);
    const versionOne = await Schema.decodeUnknownPromise(PersonProfile)(
      await initial.json()
    );
    const [fact] = versionOne.facts;
    if (fact === undefined) {
      throw new Error("Expected persisted safety fact");
    }
    const falseSelf = await post(setup.ownerCookie, {
      command: { _tag: "ConfirmProfileFact", basis: "self", factId: fact.id },
      expectedProfileVersion: 1,
      mutationId: "profile-safety-false-self",
    });
    expect(falseSelf.status).toBe(409);
    expect(await falseSelf.json()).toMatchObject({ code: "self_required" });
    const confirmation = await post(setup.memberCookie, {
      command: { _tag: "ConfirmProfileFact", basis: "self", factId: fact.id },
      expectedProfileVersion: 1,
      mutationId: "profile-safety-self",
    });
    expect(confirmation.status, await confirmation.clone().text()).toBe(200);
    expect(await confirmation.json()).toMatchObject({
      facts: [{ id: fact.id, standing: { _tag: "confirmed", basis: "self" } }],
      version: 2,
    });
    const ordinary = await post(setup.ownerCookie, {
      command: { _tag: "RemoveOrdinaryProfileFact", factId: fact.id },
      expectedProfileVersion: 2,
      mutationId: "profile-safety-bypass",
    });
    expect(ordinary.status).toBe(409);
    expect(await ordinary.json()).toMatchObject({
      code: "safety_confirmation_required",
    });
    const reduction = {
      command: {
        _tag: "ConfirmHardConstraintReduction",
        confirmation: "I confirm this safety constraint change",
        factId: fact.id,
        replacement: null,
      },
      expectedProfileVersion: 2,
      mutationId: "profile-safety-reduction",
    };
    const race = await Promise.all([
      post(setup.ownerCookie, reduction),
      post(setup.memberCookie, {
        command: { _tag: "ConfirmProfileFact", basis: "self", factId: fact.id },
        expectedProfileVersion: 2,
        mutationId: "profile-safety-racing-confirm",
      }),
    ]);
    expect(race.map((response) => response.status).toSorted()).toEqual([
      200, 409,
    ]);
    const stale = race.find((response) => response.status === 409);
    expect(await stale?.json()).toMatchObject({ code: "stale_version" });
    const current = await getRuntime().dispatchFetch(url, {
      headers: { cookie: setup.memberCookie },
    });
    const currentBytes = await current.text();
    const audit = await getRuntime().dispatchFetch(`${url}/audit`, {
      headers: { cookie: setup.ownerCookie },
    });
    const auditBytes = await audit.text();
    const outsider = await prepareInvitableAdult("Profile Outsider Runtime");
    await Promise.all(
      [url, `${url}/versions`, `${url}/versions/1`, `${url}/audit`].map(
        async (path) => {
          const denied = await getRuntime().dispatchFetch(path, {
            headers: { cookie: outsider.ownerCookie },
          });
          expect(denied.status).toBe(409);
          expect(await denied.json()).toMatchObject({
            code: "person_not_found",
          });
        }
      )
    );
    const deniedMutation = await post(outsider.ownerCookie, reduction);
    expect(deniedMutation.status).toBe(409);
    expect(await deniedMutation.json()).toMatchObject({
      code: "person_not_found",
    });
    await restartRuntime();
    const restoredCurrent = await getRuntime().dispatchFetch(url, {
      headers: { cookie: setup.memberCookie },
    });
    expect(await restoredCurrent.text()).toBe(currentBytes);
    const restoredAudit = await getRuntime().dispatchFetch(`${url}/audit`, {
      headers: { cookie: setup.ownerCookie },
    });
    expect(await restoredAudit.text()).toBe(auditBytes);
    const historical = await getRuntime().dispatchFetch(`${url}/versions/1`, {
      headers: { cookie: setup.memberCookie },
    });
    expect(await historical.json()).toEqual(
      Schema.encodeSync(PersonProfile)(versionOne)
    );
  });

  it("persists and exactly replays a provisional person profile version", async () => {
    const { adult, ownerCookie } =
      await prepareInvitableAdult("Profile Tracer");
    const url = `https://meal-planner.test/v1/household/people/${adult.id}/profile`;
    const payload = {
      command: {
        _tag: "AddProvisionalProfileFact",
        fact: {
          _tag: "FoodPreference",
          label: "Broccoli",
          sentiment: "like",
          targetKind: "ingredient",
        },
      },
      expectedProfileVersion: 0,
      mutationId: "profile-tracer-first-fact",
    };
    const request = {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    };
    const first = await getRuntime().dispatchFetch(url, request);
    expect(first.status, await first.clone().text()).toBe(200);
    const firstBody = await first.text();
    const replay = await getRuntime().dispatchFetch(url, request);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(await replay.text()).toBe(firstBody);
    const current = await getRuntime().dispatchFetch(url, {
      headers: { cookie: ownerCookie },
    });
    expect(current.status, await current.clone().text()).toBe(200);
    expect(await current.text()).toBe(firstBody);
    const history = await getRuntime().dispatchFetch(`${url}/versions`, {
      headers: { cookie: ownerCookie },
    });
    expect(history.status, await history.clone().text()).toBe(200);
    expect(await history.json()).toMatchObject({
      versions: [{ personId: adult.id, version: 1 }],
    });
    const audit = await getRuntime().dispatchFetch(`${url}/audit`, {
      headers: { cookie: ownerCookie },
    });
    expect(audit.status).toBe(200);
    expect(await audit.json()).toMatchObject({
      events: [
        {
          after: { value: payload.command.fact },
          before: null,
          nextVersion: 1,
          previousVersion: 0,
        },
      ],
    });
    const historical = await getRuntime().dispatchFetch(`${url}/versions/1`, {
      headers: { cookie: ownerCookie },
    });
    expect(await historical.text()).toBe(firstBody);
    const collision = await getRuntime().dispatchFetch(url, {
      ...request,
      body: JSON.stringify({
        ...payload,
        command: {
          ...payload.command,
          fact: { ...payload.command.fact, label: "Carrots" },
        },
      }),
    });
    expect(collision.status, await collision.clone().text()).toBe(409);
    expect(await collision.json()).toMatchObject({
      code: "mutation_collision",
    });
    const stale = await getRuntime().dispatchFetch(url, {
      ...request,
      body: JSON.stringify({ ...payload, mutationId: "profile-tracer-stale" }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_version" });
    const archive = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/${adult.id}/archive`,
      {
        body: JSON.stringify({
          expectedVersion: adult.version,
          mutationId: "profile-tracer-archive",
        }),
        headers: request.headers,
        method: "POST",
      }
    );
    expect(archive.status, await archive.clone().text()).toBe(200);
    const archived = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await archive.json()
    );
    const archivedWrite = await getRuntime().dispatchFetch(url, {
      ...request,
      body: JSON.stringify({
        ...payload,
        expectedProfileVersion: 1,
        mutationId: "profile-tracer-archived-write",
      }),
    });
    expect(archivedWrite.status).toBe(409);
    expect(await archivedWrite.json()).toMatchObject({
      code: "person_archived",
    });
    await restartRuntime();
    const archivedReplay = await getRuntime().dispatchFetch(url, request);
    expect(archivedReplay.status).toBe(200);
    expect(await archivedReplay.text()).toBe(firstBody);
    const restore = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/${adult.id}/restore`,
      {
        body: JSON.stringify({
          expectedVersion: archived.version,
          mutationId: "profile-tracer-restore",
        }),
        headers: request.headers,
        method: "POST",
      }
    );
    expect(restore.status).toBe(200);
    const restored = await getRuntime().dispatchFetch(url, {
      headers: { cookie: ownerCookie },
    });
    expect(await restored.text()).toBe(firstBody);
  });

  it("requires household authorization before batch routing", async () => {
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/recipe-import-batches",
      {
        body: JSON.stringify({
          items: [
            {
              idempotencyKey: "batch-unauthorized-item",
              source: {
                kind: "tiktok",
                url: "https://www.tiktok.com/@mealplanner/video/7510000000000000000",
              },
            },
          ],
        }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": "batch-unauthorized-request",
        },
        method: "POST",
      }
    );

    expect(response.status).toBe(401);
  });

  it("replays, isolates, and persists a privacy-safe household-local batch", async () => {
    const cookie = await signUp("Batch Boundary Member");
    const organization = await createOrganization(
      "Batch Boundary Household",
      cookie
    );
    const request = {
      items: [
        {
          idempotencyKey: "batch-boundary-item-1",
          source: {
            kind: "tiktok" as const,
            url: "https://www.tiktok.com/@mealplanner/video/7510000000000000001",
          },
        },
        {
          idempotencyKey: "batch-boundary-item-2",
          source: {
            kind: "tiktok" as const,
            url: "https://www.tiktok.com/@mealplanner/video/7510000000000000002",
          },
        },
      ],
    };
    const create = (payload: object = request) =>
      getRuntime().dispatchFetch(
        "https://meal-planner.test/v1/recipe-import-batches",
        {
          body: JSON.stringify(payload),
          headers: {
            "content-type": "application/json",
            cookie,
            "idempotency-key": "batch-boundary-request-1",
          },
          method: "POST",
        }
      );
    const response = await create();

    expect(response.status, await response.clone().text()).toBe(201);
    const batch = await Schema.decodeUnknownPromise(RecipeImportBatch)(
      await response.json()
    );
    expect(batch).toMatchObject({
      counts: {
        failed: 0,
        queued: 2,
        running: 0,
        succeeded: 0,
        total: 2,
      },
      object: "recipe_import_batch",
      status: "queued",
    });
    expect(JSON.stringify(batch)).not.toMatch(
      /batch-boundary-item|tiktok\.com|751000000000000000/iu
    );

    await Promise.all(
      batch.items.map(async (item) => {
        await expect(batchQueueResult(item.id)).resolves.toEqual({
          batchId: batch.id,
          generation: 1,
          itemId: item.id,
          organizationId: organization.id,
        });
        await expect(batchQueueDeliveries(item.id)).resolves.toBe(1);
      })
    );

    const replay = await create();
    expect(replay.status, await replay.clone().text()).toBe(201);
    await expect(replay.json()).resolves.toEqual(
      Schema.encodeSync(RecipeImportBatch)(batch)
    );
    await delay(50);
    await Promise.all(
      batch.items.map((item) =>
        expect(batchQueueDeliveries(item.id)).resolves.toBe(1)
      )
    );

    const collision = await create({
      items: [
        {
          ...request.items[0],
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@mealplanner/video/7510000000000000099",
          },
        },
      ],
    });
    expect(collision.status, await collision.clone().text()).toBe(409);

    const otherCookie = await signUp("Other Batch Boundary Member");
    await createOrganization("Other Batch Boundary Household", otherCookie);
    const isolated = await getRuntime().dispatchFetch(
      `https://meal-planner.test${batch.links.self}`,
      { headers: { cookie: otherCookie } }
    );
    expect(isolated.status).toBe(404);

    await restartRuntime();
    const persisted = await getRuntime().dispatchFetch(
      `https://meal-planner.test${batch.links.self}`,
      { headers: { cookie } }
    );
    expect(persisted.status, await persisted.clone().text()).toBe(200);
    await expect(persisted.json()).resolves.toEqual(
      Schema.encodeSync(RecipeImportBatch)(batch)
    );
    expect(organization.id).not.toBe("");
  });

  it("generation-fences replay, completion, and failure in household SQLite", async () => {
    const cookie = await signUp("Batch Lifecycle Member");
    const organization = await createOrganization(
      "Batch Lifecycle Household",
      cookie
    );
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/recipe-import-batches",
      {
        body: JSON.stringify({
          items: [
            {
              idempotencyKey: "batch-lifecycle-success",
              source: {
                kind: "tiktok",
                url: "https://www.tiktok.com/@mealplanner/video/7510000000000000101",
              },
            },
            {
              idempotencyKey: "batch-lifecycle-failure",
              source: {
                kind: "tiktok",
                url: "https://www.tiktok.com/@mealplanner/video/7510000000000000102",
              },
            },
          ],
        }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "batch-lifecycle-request",
        },
        method: "POST",
      }
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const batch = await Schema.decodeUnknownPromise(RecipeImportBatch)(
      await response.json()
    );
    const [successItem, failedItem] = batch.items;
    if (successItem === undefined || failedItem === undefined) {
      throw new Error("Expected two admitted batch items.");
    }
    const admission = {
      actor: { _tag: "System", purpose: "batch_item_dispatch" },
      organizationId: organization.id,
    } as const;
    const message = {
      batchId: batch.id,
      generation: 1,
      itemId: successItem.id,
      organizationId: organization.id,
    };
    const claim = await systemCommand("claim-batch-item", {
      admission,
      message,
    });
    expect(claim.status, await claim.clone().text()).toBe(200);
    const claimed = await claim.json();
    expect(claimed).toMatchObject({ _tag: "Claimed" });
    const claimReplay = await systemCommand("claim-batch-item", {
      admission,
      message,
    });
    expect(claimReplay.status).toBe(200);
    await expect(claimReplay.json()).resolves.toEqual(claimed);

    const staleClaim = await systemCommand("claim-batch-item", {
      admission,
      message: { ...message, generation: 2 },
    });
    expect(staleClaim.status).toBe(409);

    const complete = await systemCommand("complete-batch-item", {
      admission,
      batchId: batch.id,
      expectedGeneration: 1,
      intentId: "018f47ad-91aa-7c35-b6fe-000000000199",
      itemId: successItem.id,
    });
    expect(complete.status, await complete.clone().text()).toBe(200);
    const completed = await complete.json();
    const completeReplay = await systemCommand("complete-batch-item", {
      admission,
      batchId: batch.id,
      expectedGeneration: 1,
      intentId: "018f47ad-91aa-7c35-b6fe-000000000199",
      itemId: successItem.id,
    });
    expect(completeReplay.status).toBe(200);
    await expect(completeReplay.json()).resolves.toEqual(completed);
    const conflictingCompletion = await systemCommand("complete-batch-item", {
      admission,
      batchId: batch.id,
      expectedGeneration: 1,
      intentId: "018f47ad-91aa-7c35-b6fe-000000000198",
      itemId: successItem.id,
    });
    expect(conflictingCompletion.status).toBe(409);

    const failed = await systemCommand("fail-batch-item", {
      admission,
      batchId: batch.id,
      expectedGeneration: 1,
      failureCode: "import_admission_failed",
      itemId: failedItem.id,
    });
    expect(failed.status, await failed.clone().text()).toBe(200);
    await expect(failed.json()).resolves.toMatchObject({
      counts: { failed: 1, queued: 0, running: 0, succeeded: 1, total: 2 },
      status: "partial_failure",
    });
    const conflictingFailure = await systemCommand("fail-batch-item", {
      admission,
      batchId: batch.id,
      expectedGeneration: 1,
      failureCode: "dispatch_exhausted",
      itemId: failedItem.id,
    });
    expect(conflictingFailure.status).toBe(409);

    const staleFailure = await systemCommand("fail-batch-item", {
      admission,
      batchId: batch.id,
      expectedGeneration: 2,
      failureCode: "dispatch_exhausted",
      itemId: failedItem.id,
    });
    expect(staleFailure.status).toBe(409);
  });

  it("re-decodes and rejects a malformed clone at the private Worker boundary", async () => {
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household",
      { headers: { "x-test-private-household-malformed": "1" } }
    );
    const body = await response.text();
    expect(response.status, body).toBe(400);
    expect(body).not.toContain("organization-private-malformed");
    expect(body).not.toContain("unexpectedAuthority");
  });

  it("admits a Better Auth member before private household routing", async () => {
    const cookie = await signUp("Boundary Member");
    const organization = await createOrganization("Boundary Household", cookie);
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household",
      { headers: { cookie } }
    );
    expect(response.status).toBe(200);
    const household = await Schema.decodeUnknownPromise(
      HouseholdStatusResponse
    )(await response.json());
    expect(household).toEqual({
      createdAtEpochMs: expect.any(Number),
      organizationId: organization.id,
      status: "ready",
    });
  });

  it("admits only a Better Auth owner and resolves a two-owner creator race to one durable winner", async () => {
    const ownerLabel = "People Owner Authority";
    const ownerCookie = await signUp(ownerLabel);
    const organization = await createOrganization(
      "People Owner Authority Household",
      ownerCookie
    );
    const ownerSession = await getSession(ownerCookie);
    const memberCookie = await signUp("People Bootstrap Racer");
    const memberSession = await getSession(memberCookie);
    const authDatabase = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await authDatabase.insert(authSchema.member).values({
      createdAt: new Date(),
      id: "people-bootstrap-racer-membership",
      organizationId: organization.id,
      role: "member",
      userId: memberSession.user.id,
    });
    await authDatabase
      .update(authSchema.session)
      .set({ activeOrganizationId: organization.id })
      .where(eq(authSchema.session.id, memberSession.session.id));

    const bootstrapURL =
      "https://meal-planner.test/v1/household/people/bootstrap-creator";
    const observations = await getRuntime().getKVNamespace(
      "HOUSEHOLD_TEST_OBSERVATIONS",
      "api"
    );
    await observations.delete("people-bootstrap-private-invoked");
    const memberBootstrap = {
      body: JSON.stringify({
        displayName: "Racing member",
        mutationId: "owner-authority-bootstrap",
      }),
      headers: { "content-type": "application/json", cookie: memberCookie },
      method: "POST",
    } as const;
    const denied = await Promise.all([
      getRuntime().dispatchFetch(bootstrapURL, memberBootstrap),
      getRuntime().dispatchFetch(bootstrapURL, memberBootstrap),
    ]);
    expect(denied.map(({ status }) => status)).toEqual([403, 403]);
    await expect(
      Promise.all(denied.map((response) => response.json()))
    ).resolves.toEqual([
      {
        code: "creator_required",
        message:
          "Only the Better Auth household owner can set up the creator person.",
        status: 403,
      },
      {
        code: "creator_required",
        message:
          "Only the Better Auth household owner can set up the creator person.",
        status: 403,
      },
    ]);
    expect(
      await observations.get("people-bootstrap-private-invoked")
    ).toBeNull();

    await authDatabase
      .update(authSchema.member)
      .set({ role: "owner" })
      .where(eq(authSchema.member.id, "people-bootstrap-racer-membership"));

    const ownerBootstrap = {
      body: JSON.stringify({
        displayName: "Household owner",
        mutationId: "owner-authority-bootstrap",
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    } as const;
    const promotedOwnerBootstrap = {
      body: JSON.stringify({
        displayName: "Promoted household owner",
        mutationId: "promoted-owner-authority-bootstrap",
      }),
      headers: { "content-type": "application/json", cookie: memberCookie },
      method: "POST",
    } as const;
    const competingAttempts = await Promise.all([
      getRuntime().dispatchFetch(bootstrapURL, ownerBootstrap),
      getRuntime().dispatchFetch(bootstrapURL, promotedOwnerBootstrap),
    ]);
    expect(competingAttempts.map(({ status }) => status).toSorted()).toEqual([
      200, 409,
    ]);
    const winnerIndex = competingAttempts.findIndex(
      (response) => response.status === 200
    );
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winnerResponse = competingAttempts[winnerIndex];
    const loserResponse = competingAttempts[loserIndex];
    if (winnerResponse === undefined || loserResponse === undefined) {
      throw new Error("Expected one winner and one loser response.");
    }
    const ownerPerson = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await winnerResponse.json()
    );
    await expect(loserResponse.json()).resolves.toEqual({
      code: "bootstrap_conflict",
      message:
        "This household already has a creator person. This account remains unlinked.",
      status: 409,
    });

    const bootstrapRequests = [ownerBootstrap, promotedOwnerBootstrap] as const;
    const winnerRequest = bootstrapRequests[winnerIndex];
    const loserRequest = bootstrapRequests[loserIndex];
    if (winnerRequest === undefined || loserRequest === undefined) {
      throw new Error("Expected matching winner and loser requests.");
    }
    const winnerReplay = await getRuntime().dispatchFetch(
      bootstrapURL,
      winnerRequest
    );
    expect(winnerReplay.status).toBe(200);
    await expect(winnerReplay.json()).resolves.toEqual(
      Schema.encodeSync(HouseholdPerson)(ownerPerson)
    );
    const loserRetry = await getRuntime().dispatchFetch(
      bootstrapURL,
      loserRequest
    );
    expect(loserRetry.status).toBe(409);
    await expect(loserRetry.json()).resolves.toEqual({
      code: "bootstrap_conflict",
      message:
        "This household already has a creator person. This account remains unlinked.",
      status: 409,
    });

    const loserCookie = loserIndex === 0 ? ownerCookie : memberCookie;
    const loserRoster = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: loserCookie } }
    );
    expect(loserRoster.status).toBe(200);
    await expect(loserRoster.json()).resolves.toMatchObject({
      creatorSlot: "occupied",
      currentPersonId: null,
      people: [{ id: ownerPerson.id, isCurrentAdult: false }],
    });

    const winnerLabel =
      winnerIndex === 0 ? ownerLabel : "People Bootstrap Racer";
    const winnerSession = winnerIndex === 0 ? ownerSession : memberSession;

    await authDatabase
      .update(authSchema.member)
      .set({ id: "people-owner-membership-rotated" })
      .where(eq(authSchema.member.userId, winnerSession.user.id));
    const replacementOwnerCookie = await signIn(winnerLabel);
    const replacementOwnerSession = await getSession(replacementOwnerCookie);
    await authDatabase
      .update(authSchema.session)
      .set({ activeOrganizationId: organization.id })
      .where(eq(authSchema.session.id, replacementOwnerSession.session.id));
    await restartRuntime();

    const rosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: replacementOwnerCookie } }
    );
    expect(rosterResponse.status).toBe(200);
    await expect(rosterResponse.json()).resolves.toMatchObject({
      creatorSlot: "occupied",
      currentPersonId: ownerPerson.id,
      people: [{ id: ownerPerson.id, isCurrentAdult: true }],
    });

    const otherOrganization = await createOrganization(
      "People Owner Second Household",
      replacementOwnerCookie
    );
    expect(otherOrganization.id).not.toBe(organization.id);
    const setActiveResponse = await authRequest(
      "/organization/set-active",
      { organizationId: otherOrganization.id },
      replacementOwnerCookie
    );
    expect(setActiveResponse.status).toBe(200);
    const otherOrganizationCookie =
      setActiveResponse.headers.get("set-cookie") === null
        ? replacementOwnerCookie
        : cookieHeader(setActiveResponse);
    const otherBootstrap = await getRuntime().dispatchFetch(bootstrapURL, {
      ...ownerBootstrap,
      headers: {
        ...ownerBootstrap.headers,
        cookie: otherOrganizationCookie,
      },
    });
    expect(otherBootstrap.status).toBe(200);
    const otherPerson = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await otherBootstrap.json()
    );
    expect(otherPerson.id).not.toBe(ownerPerson.id);
  }, 30_000);

  it("routes only the owner during a concurrent owner and member creator bootstrap", async () => {
    const ownerCookie = await signUp("People Concurrent Owner");
    const organization = await createOrganization(
      "People Concurrent Owner Household",
      ownerCookie
    );
    const memberCookie = await signUp("People Concurrent Member");
    const memberSession = await getSession(memberCookie);
    const authDatabase = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await authDatabase.insert(authSchema.member).values({
      createdAt: new Date(),
      id: "people-concurrent-member-membership",
      organizationId: organization.id,
      role: "member",
      userId: memberSession.user.id,
    });
    await authDatabase
      .update(authSchema.session)
      .set({ activeOrganizationId: organization.id })
      .where(eq(authSchema.session.id, memberSession.session.id));

    const url =
      "https://meal-planner.test/v1/household/people/bootstrap-creator";
    const ownerMutationId = "concurrent-owner-bootstrap";
    const memberMutationId = "concurrent-member-bootstrap";
    const [ownerResponse, memberResponse] = await Promise.all([
      getRuntime().dispatchFetch(url, {
        body: JSON.stringify({
          displayName: "Concurrent owner",
          mutationId: ownerMutationId,
        }),
        headers: { "content-type": "application/json", cookie: ownerCookie },
        method: "POST",
      }),
      getRuntime().dispatchFetch(url, {
        body: JSON.stringify({
          displayName: "Concurrent member",
          mutationId: memberMutationId,
        }),
        headers: { "content-type": "application/json", cookie: memberCookie },
        method: "POST",
      }),
    ]);
    expect([ownerResponse.status, memberResponse.status]).toEqual([200, 403]);
    const observations = await getRuntime().getKVNamespace(
      "HOUSEHOLD_TEST_OBSERVATIONS",
      "api"
    );
    expect(
      await observations.get(
        `people-bootstrap-private-invoked:${ownerMutationId}`
      )
    ).toBe("true");
    expect(
      await observations.get(
        `people-bootstrap-private-invoked:${memberMutationId}`
      )
    ).toBeNull();
    const memberRoster = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: memberCookie } }
    );
    expect(memberRoster.status).toBe(200);
    await expect(memberRoster.json()).resolves.toMatchObject({
      creatorSlot: "occupied",
      currentPersonId: null,
      people: [expect.objectContaining({ kind: "adult" })],
    });
  }, 30_000);

  it("projects creator-slot authority independently from non-creator roster entries", async () => {
    const cookie = await signUp("People Projection Owner");
    const organization = await createOrganization(
      "People Projection Household",
      cookie
    );
    const peopleURL = "https://meal-planner.test/v1/household/people";
    const createResponse = await getRuntime().dispatchFetch(peopleURL, {
      body: JSON.stringify({
        displayName: "Projection dependant",
        kind: "dependant",
        mutationId: "projection-create-dependant",
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    });
    expect(createResponse.status, await createResponse.clone().text()).toBe(
      201
    );
    const dependant = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await createResponse.json()
    );

    const listRoster = async (activeCookie: string) => {
      const response = await getRuntime().dispatchFetch(
        `${peopleURL}?includeArchived=true`,
        { headers: { cookie: activeCookie } }
      );
      expect(response.status, await response.clone().text()).toBe(200);
      return Schema.decodeUnknownPromise(HouseholdPeopleRoster)(
        await response.json()
      );
    };

    await expect(listRoster(cookie)).resolves.toMatchObject({
      creatorSlot: "available",
      currentPersonId: null,
      people: [{ id: dependant.id, isCurrentAdult: false }],
    });

    await restartRuntime();
    await expect(listRoster(cookie)).resolves.toMatchObject({
      creatorSlot: "available",
      currentPersonId: null,
      people: [{ id: dependant.id, isCurrentAdult: false }],
    });

    const bootstrapResponse = await getRuntime().dispatchFetch(
      `${peopleURL}/bootstrap-creator`,
      {
        body: JSON.stringify({
          displayName: "People Projection Owner",
          mutationId: "projection-bootstrap-owner",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );
    expect(
      bootstrapResponse.status,
      await bootstrapResponse.clone().text()
    ).toBe(200);
    const creator = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await bootstrapResponse.json()
    );
    await expect(listRoster(cookie)).resolves.toMatchObject({
      creatorSlot: "occupied",
      currentPersonId: creator.id,
      people: expect.arrayContaining([
        expect.objectContaining({ id: dependant.id, isCurrentAdult: false }),
        expect.objectContaining({ id: creator.id, isCurrentAdult: true }),
      ]),
    });

    const otherOrganization = await createOrganization(
      "People Projection Other Household",
      cookie
    );
    expect(otherOrganization.id).not.toBe(organization.id);
    const setActiveResponse = await authRequest(
      "/organization/set-active",
      { organizationId: otherOrganization.id },
      cookie
    );
    expect(setActiveResponse.status).toBe(200);
    const otherOrganizationCookie =
      setActiveResponse.headers.get("set-cookie") === null
        ? cookie
        : cookieHeader(setActiveResponse);
    await expect(listRoster(otherOrganizationCookie)).resolves.toEqual({
      creatorSlot: "available",
      currentPersonId: null,
      people: [],
    });
  }, 30_000);

  it("runs the public people lifecycle through Better Auth, private Worker, and household SQLite", async () => {
    const cookie = await signUp("People Boundary Member");
    await createOrganization("People Boundary Household", cookie);
    const unauthenticated = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people"
    );
    expect(unauthenticated.status).toBe(401);

    const excessQuery = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true&unexpected=x",
      { headers: { cookie } }
    );
    expect(excessQuery.status).toBe(400);
    await expect(excessQuery.json()).resolves.toMatchObject({
      code: "invalid_request",
    });

    const malformed = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/bootstrap-creator",
      {
        body: JSON.stringify({
          displayName: "",
          mutationId: "public-invalid-person",
          unexpected: true,
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );
    expect(malformed.status, await malformed.clone().text()).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      code: "invalid_request",
    });

    const createBeforeBootstrap = async (
      displayName: string,
      kind: "adult" | "dependant",
      mutationId: string
    ) => {
      const response = await getRuntime().dispatchFetch(
        "https://meal-planner.test/v1/household/people",
        {
          body: JSON.stringify({ displayName, kind, mutationId }),
          headers: { "content-type": "application/json", cookie },
          method: "POST",
        }
      );
      expect(response.status, await response.clone().text()).toBe(201);
      return Schema.decodeUnknownPromise(HouseholdPerson)(
        await response.json()
      );
    };
    const unlinkedAdult = await createBeforeBootstrap(
      "Boundary unlinked adult",
      "adult",
      "public-create-unlinked-adult"
    );
    const firstDependant = await createBeforeBootstrap(
      "Boundary first dependant",
      "dependant",
      "public-create-first-dependant"
    );
    const secondDependant = await createBeforeBootstrap(
      "Boundary second dependant",
      "dependant",
      "public-create-second-dependant"
    );

    const bootstrapRequest = {
      body: JSON.stringify({
        displayName: "People Boundary Member",
        mutationId: "public-bootstrap-people",
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    } as const;
    const bootstrapResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/bootstrap-creator",
      bootstrapRequest
    );
    expect(
      bootstrapResponse.status,
      await bootstrapResponse.clone().text()
    ).toBe(200);
    const creator = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await bootstrapResponse.json()
    );
    const bootstrapReplay = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/bootstrap-creator",
      bootstrapRequest
    );
    expect(bootstrapReplay.status).toBe(200);
    await expect(bootstrapReplay.json()).resolves.toEqual(
      Schema.encodeSync(HouseholdPerson)(creator)
    );

    const collision = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/bootstrap-creator",
      {
        ...bootstrapRequest,
        body: JSON.stringify({
          displayName: "Changed intent",
          mutationId: "public-bootstrap-people",
        }),
      }
    );
    expect(collision.status).toBe(409);
    await expect(collision.json()).resolves.toMatchObject({
      code: "mutation_collision",
    });

    const createRequest = {
      body: JSON.stringify({
        displayName: "Boundary dependant",
        kind: "dependant",
        mutationId: "public-create-person",
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    } as const;
    const createResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      createRequest
    );
    expect(createResponse.status, await createResponse.clone().text()).toBe(
      201
    );
    const dependant = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await createResponse.json()
    );
    const createReplay = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      createRequest
    );
    expect(createReplay.status).toBe(201);
    await expect(createReplay.json()).resolves.toEqual(
      Schema.encodeSync(HouseholdPerson)(dependant)
    );

    const archiveResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/${dependant.id}/archive`,
      {
        body: JSON.stringify({
          expectedVersion: dependant.version,
          mutationId: "public-archive-person",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );
    expect(archiveResponse.status).toBe(200);
    await expect(archiveResponse.json()).resolves.toMatchObject({
      lifecycle: "archived",
      version: 2,
    });

    await restartRuntime();
    const restoreResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/${dependant.id}/restore`,
      {
        body: JSON.stringify({
          expectedVersion: 2,
          mutationId: "public-restore-person",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );
    expect(restoreResponse.status).toBe(200);
    await expect(restoreResponse.json()).resolves.toMatchObject({
      id: dependant.id,
      lifecycle: "active",
      version: 3,
    });

    const rosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie } }
    );
    expect(rosterResponse.status).toBe(200);
    const roster = await Schema.decodeUnknownPromise(HouseholdPeopleRoster)(
      await rosterResponse.json()
    );
    expect(roster).toMatchObject({
      creatorSlot: "occupied",
      currentPersonId: creator.id,
      people: [
        expect.objectContaining({
          id: unlinkedAdult.id,
          isCurrentAdult: false,
        }),
        expect.objectContaining({ id: firstDependant.id }),
        expect.objectContaining({ id: secondDependant.id }),
        expect.objectContaining({ id: creator.id, isCurrentAdult: true }),
        expect.objectContaining({
          id: dependant.id,
          lifecycle: "active",
          version: 3,
        }),
      ],
    });

    const otherCookie = await signUp("People Boundary Other");
    await createOrganization("People Boundary Other Household", otherCookie);
    const isolated = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/${dependant.id}`,
      { headers: { cookie: otherCookie } }
    );
    expect(isolated.status).toBe(404);
    await expect(isolated.json()).resolves.toMatchObject({
      code: "person_not_found",
    });
    const deniedMutation = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/${dependant.id}/archive`,
      {
        body: JSON.stringify({
          expectedVersion: 3,
          mutationId: "public-archive-person",
        }),
        headers: { "content-type": "application/json", cookie: otherCookie },
        method: "POST",
      }
    );
    expect(deniedMutation.status).toBe(404);
    const unchanged = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/${dependant.id}`,
      { headers: { cookie } }
    );
    expect(unchanged.status).toBe(200);
    await expect(unchanged.json()).resolves.toMatchObject({
      id: dependant.id,
      lifecycle: "active",
      version: 3,
    });
  }, 30_000);

  it("links an invited Better Auth member to the existing adult without duplicating the person", async () => {
    const ownerCookie = await signUp("People Invitation Owner");
    const organization = await createOrganization(
      "People Invitation Household",
      ownerCookie
    );
    const bootstrapResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/bootstrap-creator",
      {
        body: JSON.stringify({
          displayName: "People Invitation Owner",
          mutationId: "invite-owner-bootstrap",
        }),
        headers: { "content-type": "application/json", cookie: ownerCookie },
        method: "POST",
      }
    );
    expect(
      bootstrapResponse.status,
      await bootstrapResponse.clone().text()
    ).toBe(200);

    const adultResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      {
        body: JSON.stringify({
          displayName: "Invited household adult",
          kind: "adult",
          mutationId: "invite-create-adult",
        }),
        headers: { "content-type": "application/json", cookie: ownerCookie },
        method: "POST",
      }
    );
    expect(adultResponse.status, await adultResponse.clone().text()).toBe(201);
    const adult = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await adultResponse.json()
    );

    const profileUrl = `https://meal-planner.test/v1/household/people/${adult.id}/profile`;
    const provisionalResponse = await getRuntime().dispatchFetch(profileUrl, {
      body: JSON.stringify({
        command: {
          _tag: "AddProvisionalProfileFact",
          fact: {
            _tag: "FoodPreference",
            label: "Broccoli",
            sentiment: "like",
            targetKind: "ingredient",
          },
        },
        expectedProfileVersion: 0,
        mutationId: "invite-provisional-profile",
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    });
    expect(
      provisionalResponse.status,
      await provisionalResponse.clone().text()
    ).toBe(200);
    const provisionalBytes = await provisionalResponse.clone().text();
    const provisional = await Schema.decodeUnknownPromise(PersonProfile)(
      await provisionalResponse.json()
    );
    const [provisionalFact] = provisional.facts;
    if (provisionalFact === undefined) {
      throw new Error("Expected provisional profile fact before invitation");
    }
    const originalAudit = await getRuntime().dispatchFetch(
      `${profileUrl}/audit`,
      { headers: { cookie: ownerCookie } }
    );
    expect(originalAudit.status).toBe(200);
    const originalAuditBytes = await originalAudit.text();

    const inviteeLabel = "People Invited Adult";
    const inviteeCookie = await signUp(inviteeLabel);
    const invitationResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/invitations",
      {
        body: JSON.stringify({
          email: "people-invited-adult@example.test",
          mutationId: "invite-associate-adult",
          personId: adult.id,
        }),
        headers: { "content-type": "application/json", cookie: ownerCookie },
        method: "POST",
      }
    );
    expect(
      invitationResponse.status,
      await invitationResponse.clone().text()
    ).toBe(201);
    const invitation = await Schema.decodeUnknownPromise(
      HouseholdAdultInvitationResult
    )(await invitationResponse.json());
    expect(invitation).toMatchObject({
      association: "associated",
      person: {
        associationState: "invitation_pending",
        id: adult.id,
      },
    });
    expect(JSON.stringify(invitation)).not.toContain(
      "people-invited-adult@example.test"
    );

    const acceptance = await authRequest(
      "/organization/accept-invitation",
      { invitationId: invitation.invitationId },
      inviteeCookie
    );
    expect(acceptance.status, await acceptance.clone().text()).toBe(200);
    const wrongMemberLink = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/links/complete",
      {
        body: JSON.stringify({
          invitationId: invitation.invitationId,
          mutationId: "invite-wrong-member-link",
        }),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        method: "POST",
      }
    );
    expect(wrongMemberLink.status, await wrongMemberLink.clone().text()).toBe(
      409
    );
    const activeOrganization = await authRequest(
      "/organization/set-active",
      { organizationId: organization.id },
      inviteeCookie
    );
    expect(
      activeOrganization.status,
      await activeOrganization.clone().text()
    ).toBe(200);
    const admittedInviteeCookie =
      activeOrganization.headers.get("set-cookie") === null
        ? inviteeCookie
        : cookieHeader(activeOrganization);

    const linkRequests = [
      {
        body: JSON.stringify({
          invitationId: invitation.invitationId,
          mutationId: "invite-complete-adult-link-a",
        }),
        headers: {
          "content-type": "application/json",
          cookie: admittedInviteeCookie,
        },
        method: "POST",
      },
      {
        body: JSON.stringify({
          invitationId: invitation.invitationId,
          mutationId: "invite-complete-adult-link-b",
        }),
        headers: {
          "content-type": "application/json",
          cookie: admittedInviteeCookie,
        },
        method: "POST",
      },
    ] as const;
    const linkResponses = await Promise.all(
      linkRequests.map((request) =>
        getRuntime().dispatchFetch(
          "https://meal-planner.test/v1/household/people/links/complete",
          request
        )
      )
    );
    expect(linkResponses.map(({ status }) => status).toSorted()).toEqual([
      200, 409,
    ]);
    const successfulLinkIndex = linkResponses.findIndex(
      ({ status }) => status === 200
    );
    const linkResponse = linkResponses[successfulLinkIndex];
    const linkRequest = linkRequests[successfulLinkIndex];
    if (linkResponse === undefined || linkRequest === undefined) {
      throw new Error("Expected exactly one successful account link");
    }
    const linked = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await linkResponse.json()
    );
    expect(linked).toMatchObject({
      associationState: "linked",
      id: adult.id,
      isCurrentAdult: true,
    });

    const linkReplay = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/links/complete",
      linkRequest
    );
    expect(linkReplay.status).toBe(200);
    await expect(linkReplay.json()).resolves.toEqual(
      Schema.encodeSync(HouseholdPerson)(linked)
    );

    await restartRuntime();
    const rosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: admittedInviteeCookie } }
    );
    expect(rosterResponse.status, await rosterResponse.clone().text()).toBe(
      200
    );
    const roster = await Schema.decodeUnknownPromise(HouseholdPeopleRoster)(
      await rosterResponse.json()
    );
    expect(roster.currentPersonId).toBe(adult.id);
    expect(
      roster.people.filter((person) => person.id === adult.id)
    ).toHaveLength(1);
    expect(roster.people).toHaveLength(2);
    const linkedProfile = await getRuntime().dispatchFetch(profileUrl, {
      headers: { cookie: admittedInviteeCookie },
    });
    expect(linkedProfile.status).toBe(200);
    expect(await linkedProfile.text()).toBe(provisionalBytes);
    const linkedAudit = await getRuntime().dispatchFetch(
      `${profileUrl}/audit`,
      { headers: { cookie: admittedInviteeCookie } }
    );
    expect(linkedAudit.status).toBe(200);
    expect(await linkedAudit.text()).toBe(originalAuditBytes);
    const confirmation = await getRuntime().dispatchFetch(profileUrl, {
      body: JSON.stringify({
        command: {
          _tag: "ConfirmProfileFact",
          basis: "self",
          factId: provisionalFact.id,
        },
        expectedProfileVersion: provisional.version,
        mutationId: "invite-profile-self-confirmation",
      }),
      headers: {
        "content-type": "application/json",
        cookie: admittedInviteeCookie,
      },
      method: "POST",
    });
    expect(confirmation.status, await confirmation.clone().text()).toBe(200);
    expect(await confirmation.json()).toMatchObject({
      facts: [
        {
          id: provisionalFact.id,
          standing: { _tag: "confirmed", basis: "self" },
        },
      ],
      personId: adult.id,
      version: 2,
    });
    const historicalProfile = await getRuntime().dispatchFetch(
      `${profileUrl}/versions/1`,
      { headers: { cookie: ownerCookie } }
    );
    expect(historicalProfile.status).toBe(200);
    expect(await historicalProfile.text()).toBe(provisionalBytes);
  }, 30_000);

  it("replays a retained browser invitation through the real boundary after interruption before Better Auth", async () => {
    const setup = await prepareInvitableAdult("Invitation Intent Staging");
    const retainedBrowserPayload = {
      email: "invitation-intent-staging-adult@example.test",
      mutationId: "invitation-intent-staging",
      personId: setup.adult.id,
    } as const;
    const retainedBrowserBody = JSON.stringify(retainedBrowserPayload);
    const invitationResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/invitations",
      {
        body: retainedBrowserBody,
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
          "x-test-invitation-failure": "after-association-before-create",
        },
        method: "POST",
      }
    );
    expect(invitationResponse.status).toBe(503);

    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await expect(
      database
        .select({ id: authSchema.invitation.id })
        .from(authSchema.invitation)
        .where(eq(authSchema.invitation.organizationId, setup.organization.id))
    ).resolves.toHaveLength(0);
    const stagedRosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: setup.ownerCookie } }
    );
    expect(stagedRosterResponse.status).toBe(200);
    const stagedRoster = await Schema.decodeUnknownPromise(
      HouseholdPeopleRoster
    )(await stagedRosterResponse.json());
    expect(
      stagedRoster.people.find((person) => person.id === setup.adult.id)
    ).toMatchObject({ associationState: "invitation_pending" });

    await restartRuntime();

    const readOnlyAssociation = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/invitations/associate",
      {
        body: retainedBrowserBody,
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(readOnlyAssociation.status).toBe(404);
    await expect(readOnlyAssociation.json()).resolves.toMatchObject({
      code: "control_plane_resource_not_found",
    });

    const persistedDatabase = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await expect(
      persistedDatabase
        .select({ id: authSchema.invitation.id })
        .from(authSchema.invitation)
        .where(eq(authSchema.invitation.organizationId, setup.organization.id))
    ).resolves.toHaveLength(0);

    const replayRequest = {
      body: retainedBrowserBody,
      headers: {
        "content-type": "application/json",
        cookie: setup.ownerCookie,
      },
      method: "POST",
    } as const;
    const replay = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/invitations",
      replayRequest
    );
    expect(replay.status, await replay.clone().text()).toBe(201);
    const invitation = await Schema.decodeUnknownPromise(
      HouseholdAdultInvitationResult
    )(await replay.json());
    expect(invitation).toMatchObject({
      association: "associated",
      person: {
        associationState: "invitation_pending",
        id: setup.adult.id,
      },
    });

    await expect(
      persistedDatabase
        .select({ id: authSchema.invitation.id })
        .from(authSchema.invitation)
        .where(eq(authSchema.invitation.organizationId, setup.organization.id))
    ).resolves.toEqual([{ id: invitation.invitationId }]);
    const rosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: setup.ownerCookie } }
    );
    expect(rosterResponse.status).toBe(200);
    const roster = await Schema.decodeUnknownPromise(HouseholdPeopleRoster)(
      await rosterResponse.json()
    );
    expect(
      roster.people.filter((person) => person.id === setup.adult.id)
    ).toHaveLength(1);
  }, 30_000);

  it("replays only the exact committed browser invitation after its creation response is lost", async () => {
    const setup = await prepareInvitableAdult("Invitation Response Lost");
    const retainedBrowserPayload = {
      email: "invitation-response-lost-adult@example.test",
      mutationId: "invitation-response-lost",
      personId: setup.adult.id,
    } as const;
    const retainedBrowserBody = JSON.stringify(retainedBrowserPayload);
    const unrelatedResponse = await authRequest(
      "/organization/invite-member",
      {
        email: "unrelated-pending-adult@example.test",
        organizationId: setup.organization.id,
        role: "member",
      },
      setup.ownerCookie
    );
    expect(
      unrelatedResponse.status,
      await unrelatedResponse.clone().text()
    ).toBe(200);
    const invitationResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/invitations",
      {
        body: retainedBrowserBody,
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
          "x-test-invitation-failure": "after-create-before-response",
        },
        method: "POST",
      }
    );
    expect(invitationResponse.status).toBe(503);

    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    const invitations = await database
      .select({
        email: authSchema.invitation.email,
        id: authSchema.invitation.id,
      })
      .from(authSchema.invitation)
      .where(eq(authSchema.invitation.organizationId, setup.organization.id));
    expect(invitations).toHaveLength(2);
    const originalInvitation = invitations.find(
      ({ email }) => email === "invitation-response-lost-adult@example.test"
    );
    const unrelatedInvitation = invitations.find(
      ({ email }) => email === "unrelated-pending-adult@example.test"
    );
    if (originalInvitation === undefined) {
      throw new Error("Expected the committed Better Auth invitation");
    }
    if (unrelatedInvitation === undefined) {
      throw new Error("Expected the unrelated Better Auth invitation");
    }

    await restartRuntime();

    const replay = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/invitations",
      {
        body: retainedBrowserBody,
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(replay.status, await replay.clone().text()).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({
      association: "associated",
      invitationId: originalInvitation.id,
      person: {
        associationState: "invitation_pending",
        id: setup.adult.id,
      },
    });
    const conflictingIntent = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/invitations",
      {
        body: JSON.stringify({
          email: "unrelated-pending-adult@example.test",
          mutationId: retainedBrowserPayload.mutationId,
          personId: setup.adult.id,
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(conflictingIntent.status).toBe(409);
    await expect(conflictingIntent.json()).resolves.toMatchObject({
      code: "mutation_collision",
    });

    const readOnlyAssociation = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/invitations/associate",
      {
        body: retainedBrowserBody,
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(
      readOnlyAssociation.status,
      await readOnlyAssociation.clone().text()
    ).toBe(200);
    await expect(readOnlyAssociation.json()).resolves.toMatchObject({
      associationState: "invitation_pending",
      id: setup.adult.id,
    });
    const persistedDatabase = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await expect(
      persistedDatabase
        .select({
          email: authSchema.invitation.email,
          id: authSchema.invitation.id,
        })
        .from(authSchema.invitation)
        .where(eq(authSchema.invitation.organizationId, setup.organization.id))
    ).resolves.toEqual(
      expect.arrayContaining([originalInvitation, unrelatedInvitation])
    );
    await expect(
      persistedDatabase
        .select({ id: authSchema.invitation.id })
        .from(authSchema.invitation)
        .where(eq(authSchema.invitation.organizationId, setup.organization.id))
    ).resolves.toHaveLength(2);
  }, 30_000);

  it("repairs an accepted member link only to the explicitly selected adult", async () => {
    const setup = await prepareLinkedAdult("Explicit Link Repair");
    const replacementResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      {
        body: JSON.stringify({
          displayName: "Explicit replacement adult",
          kind: "adult",
          mutationId: "explicit-link-repair-create",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(
      replacementResponse.status,
      await replacementResponse.clone().text()
    ).toBe(201);
    const replacement = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await replacementResponse.json()
    );

    const repairRequest = {
      body: JSON.stringify({
        expectedPersonVersion: replacement.version,
        memberId: setup.memberId,
        mutationId: "explicit-link-repair",
        personId: replacement.id,
        reason: "Correct the selected household person",
      }),
      headers: {
        "content-type": "application/json",
        cookie: setup.ownerCookie,
      },
      method: "POST",
    } as const;
    const repair = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/links/repair",
      repairRequest
    );
    expect(repair.status, await repair.clone().text()).toBe(200);
    const repaired = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await repair.json()
    );
    expect(repaired).toMatchObject({
      associationState: "linked",
      id: replacement.id,
      version: replacement.version + 1,
    });

    const replay = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/links/repair",
      repairRequest
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual(
      Schema.encodeSync(HouseholdPerson)(repaired)
    );

    const rosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: setup.memberCookie } }
    );
    expect(rosterResponse.status).toBe(200);
    const roster = await Schema.decodeUnknownPromise(HouseholdPeopleRoster)(
      await rosterResponse.json()
    );
    expect(roster.currentPersonId).toBe(replacement.id);
    expect(roster.people).toHaveLength(3);
    expect(
      roster.people.find((person) => person.id === setup.adult.id)
    ).toMatchObject({ associationState: "detached", lifecycle: "active" });
  }, 30_000);

  it("links the same Better Auth user independently in two households", async () => {
    const sharedAdult = {
      cookie: await signUp("Shared Multi Household Adult"),
      label: "Shared Multi Household Adult",
    };
    const first = await prepareLinkedAdult(
      "First Multi Household",
      sharedAdult
    );
    const second = await prepareLinkedAdult(
      "Second Multi Household",
      sharedAdult
    );

    const firstActive = await authRequest(
      "/organization/set-active",
      { organizationId: first.organization.id },
      second.memberCookie
    );
    expect(firstActive.status, await firstActive.clone().text()).toBe(200);
    const firstCookie = cookieHeader(firstActive);
    const firstRosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      { headers: { cookie: firstCookie } }
    );
    expect(firstRosterResponse.status).toBe(200);
    const firstRoster = await Schema.decodeUnknownPromise(
      HouseholdPeopleRoster
    )(await firstRosterResponse.json());

    const secondActive = await authRequest(
      "/organization/set-active",
      { organizationId: second.organization.id },
      firstCookie
    );
    expect(secondActive.status, await secondActive.clone().text()).toBe(200);
    const secondCookie = cookieHeader(secondActive);
    const secondRosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      { headers: { cookie: secondCookie } }
    );
    expect(secondRosterResponse.status).toBe(200);
    const secondRoster = await Schema.decodeUnknownPromise(
      HouseholdPeopleRoster
    )(await secondRosterResponse.json());

    expect(firstRoster.currentPersonId).toBe(first.adult.id);
    expect(secondRoster.currentPersonId).toBe(second.adult.id);
    expect(first.adult.id).not.toBe(second.adult.id);
  }, 30_000);

  it("recovers a departure that crashes before Better Auth removes access", async () => {
    const setup = await prepareLinkedAdult("Departure Before Removal");
    const mutationId = "departure-before-removal";
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/departures",
      {
        body: JSON.stringify({
          expectedLinkVersion: 1,
          expectedPersonVersion: setup.adult.version,
          memberId: setup.memberId,
          mutationId,
          personId: setup.adult.id,
          reason: "Adult requested departure",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.memberCookie,
          "x-test-member-departure-crash": "before-removal",
        },
        method: "POST",
      }
    );
    expect(response.status).toBeGreaterThanOrEqual(500);
    const operation = await readDepartureByMutationEventually(
      setup.ownerCookie,
      mutationId,
      "revocation_repair_required"
    );
    expect(operation).toMatchObject({
      personId: setup.adult.id,
      state: "revocation_repair_required",
    });
    const workflow = await readDepartureWorkflowInput(setup.organization.id);
    expect(workflow.operationId).toBe(operation.operationId);
    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await expect(
      database
        .select({ id: authSchema.member.id })
        .from(authSchema.member)
        .where(eq(authSchema.member.id, setup.memberId))
    ).resolves.toHaveLength(1);

    const repair = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/departures/${operation.operationId}/retry`,
      {
        body: JSON.stringify({
          expectedOperationVersion: operation.version,
          memberId: setup.memberId,
          mutationId: "departure-before-removal-repair",
          reason: "Retry my departure",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.memberCookie,
        },
        method: "POST",
      }
    );
    expect(repair.status, await repair.clone().text()).toBe(202);
    expect(await repair.clone().json()).toMatchObject({
      operationId: operation.operationId,
    });
    const completed = await readDepartureByMutationEventually(
      setup.ownerCookie,
      mutationId,
      "completed"
    );
    expect(completed).toMatchObject({
      executionGeneration: 2,
      operationId: operation.operationId,
      personId: setup.adult.id,
      state: "completed",
    });
    await expect(
      database
        .select({ id: authSchema.member.id })
        .from(authSchema.member)
        .where(eq(authSchema.member.id, setup.memberId))
    ).resolves.toHaveLength(0);
  }, 30_000);

  it("recovers and cancels the exact prepared departure after its response is lost", async () => {
    const setup = await prepareLinkedAdult("Departure Prepared Recovery");
    const mutationId = "departure-prepared-response-lost";
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/departures",
      {
        body: JSON.stringify({
          expectedLinkVersion: 1,
          expectedPersonVersion: setup.adult.version,
          memberId: setup.memberId,
          mutationId,
          personId: setup.adult.id,
          reason: "Adult requested departure",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
          "x-test-member-departure-crash": "after-prepare-before-start",
        },
        method: "POST",
      }
    );
    expect(response.status).toBeGreaterThanOrEqual(500);

    const prepared = await readDepartureByMutationEventually(
      setup.ownerCookie,
      mutationId,
      "prepared"
    );
    const recoveredAgain = await readDepartureByMutationEventually(
      setup.ownerCookie,
      mutationId,
      "prepared"
    );
    expect(recoveredAgain.operationId).toBe(prepared.operationId);

    const cancelledResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/departures/${prepared.operationId}/cancel`,
      {
        body: JSON.stringify({
          expectedOperationVersion: prepared.version,
          mutationId: "departure-prepared-cancel",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(
      cancelledResponse.status,
      await cancelledResponse.clone().text()
    ).toBe(200);
    expect(await cancelledResponse.json()).toMatchObject({
      operationId: prepared.operationId,
      state: "cancelled",
    });
    const cancelled = await readDepartureByMutationEventually(
      setup.ownerCookie,
      mutationId,
      "cancelled"
    );
    expect(cancelled.operationId).toBe(prepared.operationId);

    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await expect(
      database
        .select({ id: authSchema.member.id })
        .from(authSchema.member)
        .where(eq(authSchema.member.id, setup.memberId))
    ).resolves.toHaveLength(1);
    const rosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      { headers: { cookie: setup.ownerCookie } }
    );
    expect(rosterResponse.status).toBe(200);
    const roster = await Schema.decodeUnknownPromise(HouseholdPeopleRoster)(
      await rosterResponse.json()
    );
    expect(
      roster.people.find((person) => person.id === setup.adult.id)
    ).toMatchObject({ associationState: "linked", lifecycle: "active" });
  }, 30_000);

  it("preserves a replacement membership until an explicit departure repair targets it", async () => {
    const setup = await prepareLinkedAdult("Departure Replacement Member");
    const initial = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/departures",
      {
        body: JSON.stringify({
          expectedLinkVersion: 1,
          expectedPersonVersion: setup.adult.version,
          memberId: setup.memberId,
          mutationId: "departure-replacement-start",
          personId: setup.adult.id,
          reason: "Adult requested departure",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.memberCookie,
          "x-test-member-departure-crash": "before-removal",
        },
        method: "POST",
      }
    );
    expect(initial.status).toBeGreaterThanOrEqual(500);
    const workflow = await readDepartureWorkflowInput(setup.organization.id);
    const firstRepair = await readDepartureEventually(
      setup.ownerCookie,
      workflow.operationId,
      "revocation_repair_required"
    );
    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    const replacementMemberId = `${setup.memberId}-replacement`;
    await database
      .update(authSchema.member)
      .set({ id: replacementMemberId })
      .where(eq(authSchema.member.id, setup.memberId));

    const staleMemberRepair = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/departures/${workflow.operationId}/retry`,
      {
        body: JSON.stringify({
          expectedOperationVersion: firstRepair.version,
          memberId: setup.memberId,
          mutationId: "departure-replacement-stale-member",
          reason: "Retry after membership changed",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.memberCookie,
        },
        method: "POST",
      }
    );
    expect(staleMemberRepair.status).toBe(202);
    const replacementProtected = await readDepartureEventually(
      setup.ownerCookie,
      workflow.operationId,
      "revocation_repair_required"
    );
    await expect(
      database
        .select({ id: authSchema.member.id })
        .from(authSchema.member)
        .where(eq(authSchema.member.id, replacementMemberId))
    ).resolves.toHaveLength(1);

    const exactMemberRepair = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/departures/${workflow.operationId}/retry`,
      {
        body: JSON.stringify({
          expectedOperationVersion: replacementProtected.version,
          memberId: replacementMemberId,
          mutationId: "departure-replacement-exact-member",
          reason: "Confirm the replacement membership departure",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.memberCookie,
        },
        method: "POST",
      }
    );
    expect(
      exactMemberRepair.status,
      await exactMemberRepair.clone().text()
    ).toBe(202);
    await readDepartureEventually(
      setup.ownerCookie,
      workflow.operationId,
      "completed"
    );
    await expect(
      database
        .select({ id: authSchema.member.id })
        .from(authSchema.member)
        .where(eq(authSchema.member.id, replacementMemberId))
    ).resolves.toHaveLength(0);
  }, 30_000);

  it("finishes a departure after access removal commits but its signal is lost", async () => {
    const setup = await prepareLinkedAdult("Departure After Removal");
    const mutationId = "departure-after-removal";
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/departures",
      {
        body: JSON.stringify({
          expectedLinkVersion: 1,
          expectedPersonVersion: setup.adult.version,
          memberId: setup.memberId,
          mutationId,
          personId: setup.adult.id,
          reason: "Adult requested departure",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
          "x-test-member-departure-crash": "after-removal-before-signal",
        },
        method: "POST",
      }
    );
    expect(response.status).toBeGreaterThanOrEqual(500);

    const operation = await readDepartureByMutationEventually(
      setup.ownerCookie,
      mutationId,
      "completed"
    );
    expect(operation).toMatchObject({
      personId: setup.adult.id,
      state: "completed",
    });
    const recoveredAgain = await readDepartureByMutationEventually(
      setup.ownerCookie,
      mutationId,
      "completed"
    );
    expect(recoveredAgain.operationId).toBe(operation.operationId);
    const workflow = await readDepartureWorkflowInput(setup.organization.id);
    expect(workflow.operationId).toBe(operation.operationId);
    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await expect(
      database
        .select({ id: authSchema.member.id })
        .from(authSchema.member)
        .where(eq(authSchema.member.id, setup.memberId))
    ).resolves.toHaveLength(0);
    const rosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: setup.ownerCookie } }
    );
    expect(rosterResponse.status).toBe(200);
    const roster = await Schema.decodeUnknownPromise(HouseholdPeopleRoster)(
      await rosterResponse.json()
    );
    expect(
      roster.people.find((person) => person.id === setup.adult.id)
    ).toMatchObject({ associationState: "detached", lifecycle: "archived" });
  }, 30_000);

  it("retries finalization repair on the original departure operation", async () => {
    const setup = await prepareLinkedAdult("Departure Finalization Repair");
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/departures",
      {
        body: JSON.stringify({
          expectedLinkVersion: 1,
          expectedPersonVersion: setup.adult.version,
          memberId: setup.memberId,
          mutationId: "departure-finalization-repair-start",
          personId: setup.adult.id,
          reason: "Adult requested departure",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
          "x-test-member-departure-finalization-repair": "1",
        },
        method: "POST",
      }
    );
    expect(response.status, await response.clone().text()).toBe(202);
    const started = await Schema.decodeUnknownPromise(
      HouseholdMemberDepartureOperation
    )(await response.json());
    const repairRequired = await readDepartureEventually(
      setup.ownerCookie,
      started.operationId,
      "finalization_repair_required"
    );
    expect(repairRequired).toMatchObject({
      operationId: started.operationId,
      personId: setup.adult.id,
      state: "finalization_repair_required",
    });

    const retryRequest = {
      body: JSON.stringify({
        expectedOperationVersion: repairRequired.version,
        memberId: setup.memberId,
        mutationId: "departure-finalization-repair-retry",
        reason: "Finish the original departure",
      }),
      headers: {
        "content-type": "application/json",
        cookie: setup.ownerCookie,
      },
      method: "POST",
    } as const;
    const retry = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/household/people/departures/${started.operationId}/retry`,
      retryRequest
    );
    expect(retry.status, await retry.clone().text()).toBe(202);
    expect(await retry.json()).toMatchObject({
      operationId: started.operationId,
    });
    const completed = await readDepartureEventually(
      setup.ownerCookie,
      started.operationId,
      "completed"
    );
    expect(completed).toMatchObject({
      operationId: started.operationId,
      personId: setup.adult.id,
      state: "completed",
    });
  }, 30_000);

  it("returns an invited former member to the same historical person", async () => {
    const setup = await prepareLinkedAdult("Returning Historical Adult");
    const profileUrl = `https://meal-planner.test/v1/household/people/${setup.adult.id}/profile`;
    const initialProfileResponse = await getRuntime().dispatchFetch(
      profileUrl,
      {
        body: JSON.stringify({
          command: {
            _tag: "AddProvisionalProfileFact",
            fact: {
              _tag: "FoodPreference",
              label: "Carrots",
              sentiment: "like",
              targetKind: "ingredient",
            },
          },
          expectedProfileVersion: 0,
          mutationId: "returning-adult-profile",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(
      initialProfileResponse.status,
      await initialProfileResponse.clone().text()
    ).toBe(200);
    const profileBytes = await initialProfileResponse.clone().text();
    const initialProfile = await Schema.decodeUnknownPromise(PersonProfile)(
      await initialProfileResponse.json()
    );
    const [fact] = initialProfile.facts;
    if (fact === undefined) {
      throw new Error("Expected persisted profile before departure");
    }
    const auditResponse = await getRuntime().dispatchFetch(
      `${profileUrl}/audit`,
      { headers: { cookie: setup.ownerCookie } }
    );
    expect(auditResponse.status).toBe(200);
    const auditBytes = await auditResponse.text();
    const departure = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/departures",
      {
        body: JSON.stringify({
          expectedLinkVersion: 1,
          expectedPersonVersion: setup.adult.version,
          memberId: setup.memberId,
          mutationId: "returning-adult-depart",
          personId: setup.adult.id,
          reason: "Adult left the household",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(departure.status, await departure.clone().text()).toBe(202);
    const workflow = await readDepartureWorkflowInput(setup.organization.id);
    await readDepartureEventually(
      setup.ownerCookie,
      workflow.operationId,
      "completed"
    );

    const archivedRosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: setup.ownerCookie } }
    );
    expect(archivedRosterResponse.status).toBe(200);
    const archivedRoster = await Schema.decodeUnknownPromise(
      HouseholdPeopleRoster
    )(await archivedRosterResponse.json());
    const archived = archivedRoster.people.find(
      (person) => person.id === setup.adult.id
    );
    expect(archived).toMatchObject({
      associationState: "detached",
      lifecycle: "archived",
    });
    if (archived === undefined) {
      throw new Error("Expected the departed adult to remain archived");
    }

    await restartRuntime();
    await Promise.all(
      ["", "/versions/1"].map(async (suffix) => {
        const preserved = await getRuntime().dispatchFetch(
          `${profileUrl}${suffix}`,
          { headers: { cookie: setup.ownerCookie } }
        );
        expect(preserved.status).toBe(200);
        expect(await preserved.text()).toBe(profileBytes);
      })
    );
    const archivedAudit = await getRuntime().dispatchFetch(
      `${profileUrl}/audit`,
      { headers: { cookie: setup.ownerCookie } }
    );
    expect(archivedAudit.status).toBe(200);
    expect(await archivedAudit.text()).toBe(auditBytes);
    const departedRead = await getRuntime().dispatchFetch(profileUrl, {
      headers: { cookie: setup.memberCookie },
    });
    expect(departedRead.status).toBe(401);

    const invitationResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/invitations",
      {
        body: JSON.stringify({
          email: "returning-historical-adult-adult@example.test",
          mutationId: "returning-adult-invite",
          personId: archived.id,
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(
      invitationResponse.status,
      await invitationResponse.clone().text()
    ).toBe(201);
    const invitation = await Schema.decodeUnknownPromise(
      HouseholdAdultInvitationResult
    )(await invitationResponse.json());
    expect(invitation.person).toMatchObject({
      id: archived.id,
      lifecycle: "archived",
    });

    const returningCookie = await signIn("Returning Historical Adult Adult");
    const acceptance = await authRequest(
      "/organization/accept-invitation",
      { invitationId: invitation.invitationId },
      returningCookie
    );
    expect(acceptance.status, await acceptance.clone().text()).toBe(200);
    const wrongMemberRestore = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/return",
      {
        body: JSON.stringify({
          expectedPersonVersion: invitation.person?.version,
          invitationId: invitation.invitationId,
          mutationId: "returning-adult-wrong-member",
          personId: archived.id,
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(
      wrongMemberRestore.status,
      await wrongMemberRestore.clone().text()
    ).toBe(409);
    const active = await authRequest(
      "/organization/set-active",
      { organizationId: setup.organization.id },
      returningCookie
    );
    expect(active.status, await active.clone().text()).toBe(200);
    const admittedCookie = cookieHeader(active);
    const returnRequest = {
      body: JSON.stringify({
        expectedPersonVersion: invitation.person?.version,
        invitationId: invitation.invitationId,
        mutationId: "returning-adult-restore",
        personId: archived.id,
      }),
      headers: {
        "content-type": "application/json",
        cookie: admittedCookie,
      },
      method: "POST",
    } as const;
    const restoredResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/return",
      returnRequest
    );
    expect(restoredResponse.status, await restoredResponse.clone().text()).toBe(
      200
    );
    const restored = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await restoredResponse.json()
    );
    expect(restored).toMatchObject({
      associationState: "linked",
      id: archived.id,
      isCurrentAdult: true,
      lifecycle: "active",
    });

    const replay = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/return",
      returnRequest
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual(
      Schema.encodeSync(HouseholdPerson)(restored)
    );
    const returnedProfile = await getRuntime().dispatchFetch(profileUrl, {
      headers: { cookie: admittedCookie },
    });
    expect(returnedProfile.status).toBe(200);
    expect(await returnedProfile.text()).toBe(profileBytes);
    const returnedAudit = await getRuntime().dispatchFetch(
      `${profileUrl}/audit`,
      { headers: { cookie: admittedCookie } }
    );
    expect(returnedAudit.status).toBe(200);
    expect(await returnedAudit.text()).toBe(auditBytes);
    const confirmation = await getRuntime().dispatchFetch(profileUrl, {
      body: JSON.stringify({
        command: { _tag: "ConfirmProfileFact", basis: "self", factId: fact.id },
        expectedProfileVersion: initialProfile.version,
        mutationId: "returning-adult-self-confirmation",
      }),
      headers: { "content-type": "application/json", cookie: admittedCookie },
      method: "POST",
    });
    expect(confirmation.status, await confirmation.clone().text()).toBe(200);
    expect(await confirmation.json()).toMatchObject({
      facts: [{ id: fact.id, standing: { _tag: "confirmed", basis: "self" } }],
      personId: restored.id,
      version: 2,
    });
    const historicalProfile = await getRuntime().dispatchFetch(
      `${profileUrl}/versions/1`,
      { headers: { cookie: admittedCookie } }
    );
    expect(historicalProfile.status).toBe(200);
    expect(await historicalProfile.text()).toBe(profileBytes);
  }, 30_000);

  it("preserves the last owner and requires an explicit repair outcome", async () => {
    const ownerLabel = "Departure Last Owner";
    const ownerCookie = await signUp(ownerLabel);
    const organization = await createOrganization(
      "Departure Last Owner Household",
      ownerCookie
    );
    const bootstrap = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/bootstrap-creator",
      {
        body: JSON.stringify({
          displayName: ownerLabel,
          mutationId: "departure-last-owner-bootstrap",
        }),
        headers: { "content-type": "application/json", cookie: ownerCookie },
        method: "POST",
      }
    );
    expect(bootstrap.status, await bootstrap.clone().text()).toBe(200);
    const person = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await bootstrap.json()
    );
    const session = await getSession(ownerCookie);
    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    const [membership] = await database
      .select({ id: authSchema.member.id })
      .from(authSchema.member)
      .where(
        and(
          eq(authSchema.member.organizationId, organization.id),
          eq(authSchema.member.userId, session.user.id)
        )
      )
      .limit(1);
    if (membership === undefined) {
      throw new Error("Expected the creator membership");
    }

    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/departures",
      {
        body: JSON.stringify({
          expectedLinkVersion: 1,
          expectedPersonVersion: person.version,
          memberId: membership.id,
          mutationId: "departure-last-owner-start",
          personId: person.id,
          reason: "Last owner attempted departure",
        }),
        headers: { "content-type": "application/json", cookie: ownerCookie },
        method: "POST",
      }
    );
    expect(response.status).toBe(503);
    const workflow = await readDepartureWorkflowInput(organization.id);
    const operation = await readDepartureEventually(
      ownerCookie,
      workflow.operationId,
      "revocation_repair_required"
    );
    expect(operation).toMatchObject({ personId: person.id });
    await expect(
      database
        .select({ id: authSchema.member.id })
        .from(authSchema.member)
        .where(eq(authSchema.member.id, membership.id))
    ).resolves.toHaveLength(1);
    const rosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: ownerCookie } }
    );
    expect(rosterResponse.status).toBe(200);
    await expect(rosterResponse.json()).resolves.toMatchObject({
      currentPersonId: null,
      people: [
        expect.objectContaining({
          associationState: "departure_pending",
          id: person.id,
          lifecycle: "active",
        }),
      ],
    });
  }, 30_000);

  it("runs public admission through system draft commit, confirmation, Recipe Bank, and planning", async () => {
    const cookie = await signUp("Import Boundary Member");
    const organization = await createOrganization(
      "Import Boundary Household",
      cookie
    );
    const createResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/recipe-import-intents",
      {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@mealplanner/video/7000000000000000099",
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "public-provider-free-admission",
        },
        method: "POST",
      }
    );
    expect(createResponse.status).toBe(201);
    const admitted = await Schema.decodeUnknownPromise(RecipeImportIntent)(
      await createResponse.json()
    );
    expect(admitted).toMatchObject({ intentVersion: 1, status: "processing" });

    const systemAdmission = {
      actor: { _tag: "System", purpose: "recipe_import_lifecycle_commit" },
      organizationId: organization.id,
    } as const;
    const resolvedResponse = await systemCommand("resolve", {
      admission: systemAdmission,
      canonicalSourceId: "tiktok:video:7000000000000000099",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000099",
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "1".repeat(64),
      sourceKind: "video",
    });
    expect(resolvedResponse.status).toBe(200);

    const draftResponse = await systemCommand("commit-draft", {
      admission: systemAdmission,
      evidenceFingerprint: "2".repeat(64),
      expectedGeneration: 1,
      extractionFingerprint: "3".repeat(64),
      intentId: admitted.id,
      mutationId: "4".repeat(64),
      review,
    });
    expect(draftResponse.status).toBe(200);
    const draft = (await draftResponse.json()) as {
      readonly action: { readonly id: string };
      readonly intent: unknown;
    };
    expect(draft).toMatchObject({
      action: { actionVersion: 1, status: "active" },
      intent: { intentVersion: 3, status: "requires_action" },
    });

    const actionResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/actions/${draft.action.id}`,
      { headers: { cookie } }
    );
    expect(actionResponse.status).toBe(200);
    const action = await Schema.decodeUnknownPromise(RecipeImportAction)(
      await actionResponse.json()
    );

    const confirmResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/actions/${action.id}/confirm`,
      {
        body: JSON.stringify({ expectedActionVersion: action.actionVersion }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "public-provider-free-confirmation",
        },
        method: "POST",
      }
    );
    expect(confirmResponse.status).toBe(200);
    const confirmed = await Schema.decodeUnknownPromise(RecipeImportIntent)(
      await confirmResponse.json()
    );
    expect(confirmed).toMatchObject({
      intentVersion: 5,
      result: { recipeId: expect.any(String) },
      status: "succeeded",
    });
    if (confirmed.status !== "succeeded") {
      throw new Error("Expected a succeeded import.");
    }

    const recipeResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipes/${confirmed.result.recipeId}`,
      { headers: { cookie } }
    );
    expect(recipeResponse.status).toBe(200);
    const published = await Schema.decodeUnknownPromise(Recipe)(
      await recipeResponse.json()
    );
    expect(published.recipe.name).toBe("Public household tracer stew");

    const timelineResponse = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/timeline`,
      { headers: { cookie } }
    );
    expect(timelineResponse.status).toBe(200);
    const timeline = await Schema.decodeUnknownPromise(RecipeImportTimeline)(
      await timelineResponse.json()
    );
    expect(timeline.data.map(({ type }) => type)).toEqual([
      "intent_admitted",
      "source_resolved",
      "action_available",
      "processing_stage_changed",
      "intent_succeeded",
    ]);

    const mealPlanResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/meal-plans",
      {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createPayload)
        ),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );
    expect(mealPlanResponse.status).toBe(201);
    const mealPlan = await Schema.decodeUnknownPromise(
      HouseholdMealPlanResponse
    )(await mealPlanResponse.json());
    expect(mealPlan).toMatchObject({
      gaps: [],
      meals: [
        {
          slotId: "boundary-dinner",
          sourceRecipe: { importId: admitted.id },
        },
      ],
    });
  }, 30_000);

  it("commits verified R2 acquisition evidence through the private household authority", async () => {
    const cookie = await signUp("Evidence Boundary Member");
    const organization = await createOrganization(
      "Evidence Boundary Household",
      cookie
    );
    const createResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/recipe-import-intents",
      {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@mealplanner/video/7000000000000000100",
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "provider-free-evidence-admission",
        },
        method: "POST",
      }
    );
    expect(createResponse.status).toBe(201);
    const admitted = await Schema.decodeUnknownPromise(RecipeImportIntent)(
      await createResponse.json()
    );
    const admission = {
      actor: { _tag: "System", purpose: "recipe_import_lifecycle_commit" },
      organizationId: organization.id,
    } as const;
    const resolvedResponse = await systemCommand("resolve", {
      admission,
      canonicalSourceId: "tiktok:video:7000000000000000100",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000100",
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "5".repeat(64),
      sourceKind: "video",
    });
    expect(resolvedResponse.status).toBe(200);
    const claimed = await systemCommand("claim-acquisition-attempt", {
      admission,
      attemptIdentity: "4".repeat(64),
      attemptOrdinal: 1,
      canonicalSourceId: "tiktok:video:7000000000000000100",
      expectedGeneration: 1,
      intentId: admitted.id,
    });
    expect(claimed.status, await claimed.text()).toBe(200);

    const mediaKey = `imports/${admitted.id}/acquisition/v1/generations/1/original.mp4`;
    const manifestKey = `imports/${admitted.id}/acquisition/v1/generations/1/manifest.json`;
    const acquiredAt = new Date(Date.now() + 60_000);
    const deleteAt = new Date(acquiredAt.getTime() + 604_800_000).toISOString();
    const commitResponse = await systemCommand("commit-acquisition-evidence", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "6".repeat(64),
      result: {
        acquiredAt: acquiredAt.toISOString(),
        audioStreams: [{ codec: "aac", index: 0 }],
        durationSeconds: 20,
        references: [
          {
            byteLength: 4096,
            deleteAt,
            key: mediaKey,
            kind: "original_media",
            sha256: "7".repeat(64),
          },
          {
            byteLength: 512,
            deleteAt,
            key: manifestKey,
            kind: "acquisition_manifest",
            sha256: "8".repeat(64),
          },
        ],
        videoStreams: [{ codec: "h264", index: 0 }],
      },
    });
    expect(commitResponse.status, await commitResponse.text()).toBe(200);
  }, 30_000);

  it("replays durable acquisition identities and advances generations exactly once", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Acquisition Allocation Member",
      mutationId: "a".repeat(64),
      videoId: "7000000000000000199",
    });
    const firstReplay = await systemCommand("claim-acquisition-attempt", {
      admission,
      attemptIdentity: "1".repeat(64),
      attemptOrdinal: 1,
      canonicalSourceId: "tiktok:video:7000000000000000199",
      expectedGeneration: 1,
      intentId: admitted.id,
    });
    expect(firstReplay.status, await firstReplay.clone().text()).toBe(200);
    await expect(
      Schema.decodeUnknownPromise(HouseholdClaimAcquisitionAttemptResult)(
        await firstReplay.json()
      )
    ).resolves.toMatchObject({
      attempt: {
        acquisitionAttemptGeneration: 1,
        attemptOrdinal: 1,
      },
      outcome: "Replay",
    });

    const secondClaim = await systemCommand("claim-acquisition-attempt", {
      admission,
      attemptIdentity: "2".repeat(64),
      attemptOrdinal: 2,
      canonicalSourceId: "tiktok:video:7000000000000000199",
      expectedGeneration: 1,
      intentId: admitted.id,
    });
    expect(secondClaim.status, await secondClaim.clone().text()).toBe(200);
    await expect(
      Schema.decodeUnknownPromise(HouseholdClaimAcquisitionAttemptResult)(
        await secondClaim.json()
      )
    ).resolves.toMatchObject({
      attempt: {
        acquisitionAttemptGeneration: 2,
        attemptOrdinal: 2,
      },
      outcome: "Claimed",
    });

    const conflict = await systemCommand("claim-acquisition-attempt", {
      admission,
      attemptIdentity: "1".repeat(64),
      attemptOrdinal: 2,
      canonicalSourceId: "tiktok:video:7000000000000000199",
      expectedGeneration: 1,
      intentId: admitted.id,
    });
    expect(conflict.status).toBe(409);

    const read = await systemCommand("read-acquisition-attempts", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
    });
    expect(read.status, await read.clone().text()).toBe(200);
    await expect(
      Schema.decodeUnknownPromise(HouseholdReadAcquisitionAttemptsResult)(
        await read.json()
      )
    ).resolves.toMatchObject([
      { acquisitionAttemptGeneration: 1, attemptOrdinal: 1 },
      { acquisitionAttemptGeneration: 2, attemptOrdinal: 2 },
    ]);
  }, 30_000);

  it("rejects stale evidence without mutation and accepts the corrected generation", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Stale Evidence Member",
      mutationId: "9".repeat(64),
      videoId: "7000000000000000104",
    });
    const acquiredAt = new Date(Date.now() + 60_000);
    const mutationId = "a".repeat(64);
    const staleResponse = await systemCommand("commit-acquisition-evidence", {
      acquisitionAttemptGeneration: 2,
      admission,
      expectedGeneration: 2,
      intentId: admitted.id,
      mutationId,
      result: evidenceRetentionResult({
        acquiredAt,
        generation: 2,
        intentId: admitted.id,
      }),
    });
    expect(staleResponse.status).toBe(409);

    const correctedResponse = await systemCommand(
      "commit-acquisition-evidence",
      {
        acquisitionAttemptGeneration: 1,
        admission,
        expectedGeneration: 1,
        intentId: admitted.id,
        mutationId,
        result: evidenceRetentionResult({
          acquiredAt,
          generation: 1,
          intentId: admitted.id,
        }),
      }
    );
    expect(correctedResponse.status, await correctedResponse.text()).toBe(200);
  }, 30_000);

  it("commits a closed speech result with replay and generation fencing", async () => {
    const { admission, admitted, cookie } = await admitResolvedEvidenceImport({
      label: "Speech Evidence Stage Member",
      mutationId: "1".repeat(64),
      videoId: "7000000000000000130",
    });
    const inputFingerprint = "2".repeat(64);
    const dispatchId = `speech:${admitted.id}:1`;
    const stale = await systemCommand("mutate-evidence-stage", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 2,
      inputFingerprint,
      intentId: admitted.id,
      mutationId: "3".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId,
        stage: "speech",
        startedAt: new Date().toISOString(),
      },
    });
    expect(stale.status).toBe(409);
    const claim = await systemCommand("mutate-evidence-stage", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      mutationId: "4".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId,
        stage: "speech",
        startedAt: new Date().toISOString(),
      },
    });
    expect(claim.status, await claim.text()).toBe(200);

    const completedAt = new Date();
    const expiresAtEpochMs = Date.now() + 2000;
    const deleteAt = new Date(expiresAtEpochMs);
    const transcriptKey = `imports/${admitted.id}/transcription/v1/generations/1/transcript.json`;
    const command = {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      mutationId: "5".repeat(64),
      operation: {
        _tag: "Complete",
        dispatchId,
        reference: {
          byteLength: 512,
          deleteAt: deleteAt.toISOString(),
          key: transcriptKey,
          kind: "speech_transcript",
          sha256: "6".repeat(64),
        },
        result: {
          _tag: "Speech",
          completedAt: completedAt.toISOString(),
          cost: {
            certainty: "known",
            currency: "USD",
            estimatedMicroUsd: 12,
          },
          detectedLanguage: "en",
          dispatchId,
          model: "provider-model",
          provider: "workers-ai",
          segmentsCount: 4,
          sourceMediaSha256: inputFingerprint,
          transcriptKey,
          transcriptSha256: "6".repeat(64),
          usage: { audioDurationMilliseconds: 20_000, inputBytes: 1024 },
        },
        stage: "speech",
      },
    } as const;
    const staleDispatchId = `speech:${admitted.id}:stale`;
    const mismatched = await systemCommand("mutate-evidence-stage", {
      ...command,
      mutationId: "7".repeat(64),
      operation: {
        ...command.operation,
        dispatchId: staleDispatchId,
        result: { ...command.operation.result, dispatchId: staleDispatchId },
      },
    });
    expect(mismatched.status).toBe(409);

    const completed = await systemCommand("mutate-evidence-stage", command);
    expect(completed.status, await completed.clone().text()).toBe(200);
    const receipt = await Schema.decodeUnknownPromise(
      HouseholdMutateEvidenceStageResult
    )(await completed.json());
    const retry = await systemCommand("mutate-evidence-stage", command);
    expect(retry.status, await retry.clone().text()).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(HouseholdMutateEvidenceStageResult)(
        await retry.json()
      )
    ).toEqual(receipt);
    expect(receipt).not.toHaveProperty("result");
    expect(receipt).not.toHaveProperty("transcriptKey");

    await delay(Math.max(0, expiresAtEpochMs - Date.now() + 100));
    await restartRuntime();
    const expiredReplay = await systemCommand("mutate-evidence-stage", command);
    expect(expiredReplay.status, await expiredReplay.clone().text()).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(HouseholdMutateEvidenceStageResult)(
        await expiredReplay.json()
      )
    ).toEqual(receipt);
    const expiredFirstWrite = await systemCommand("mutate-evidence-stage", {
      ...command,
      mutationId: "0".repeat(64),
    });
    expect(expiredFirstWrite.status).toBe(400);

    const read = await systemCommand("read-evidence-stage", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      stage: "speech",
    });
    expect(read.status, await read.clone().text()).toBe(200);
    const stage = await Schema.decodeUnknownPromise(
      HouseholdReadEvidenceStageResult
    )(await read.json());
    expect(stage).toMatchObject({
      inputFingerprint,
      outcome: "Completed",
      result: { _tag: "Speech", transcriptKey },
      stage: "speech",
    });

    const cancelled = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/cancel`,
      {
        body: JSON.stringify({ expectedIntentVersion: 2 }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "complete-receipt-terminal-replay",
        },
        method: "POST",
      }
    );
    expect(cancelled.status, await cancelled.text()).toBe(200);
    const terminalReplay = await systemCommand(
      "mutate-evidence-stage",
      command
    );
    expect(terminalReplay.status, await terminalReplay.clone().text()).toBe(
      200
    );
    expect(
      await Schema.decodeUnknownPromise(HouseholdMutateEvidenceStageResult)(
        await terminalReplay.json()
      )
    ).toEqual(receipt);
    const newTerminalCompletion = await systemCommand("mutate-evidence-stage", {
      ...command,
      mutationId: "f".repeat(64),
    });
    expect(newTerminalCompletion.status).toBe(400);
  }, 30_000);

  it("rejects new stage mutations after cancellation while replaying the committed claim receipt", async () => {
    const { admission, admitted, cookie } = await admitResolvedEvidenceImport({
      label: "Cancelled Evidence Stage Member",
      mutationId: "8".repeat(64),
      videoId: "7000000000000000131",
    });
    const dispatchId = `speech:${admitted.id}:1`;
    const claimCommand = {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      inputFingerprint: "9".repeat(64),
      intentId: admitted.id,
      mutationId: "a".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId,
        stage: "speech",
        startedAt: new Date().toISOString(),
      },
    } as const;
    const claimed = await systemCommand("mutate-evidence-stage", claimCommand);
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    const claimReceipt = await Schema.decodeUnknownPromise(
      HouseholdMutateEvidenceStageResult
    )(await claimed.json());
    const failureCommand = {
      ...claimCommand,
      mutationId: "c".repeat(64),
      operation: {
        _tag: "Fail",
        completedAt: new Date().toISOString(),
        dispatchId,
        failureCode: "transcription_failed",
        recovery: "retry_later",
        stage: "speech",
      },
    } as const;
    const staleDispatchId = `speech:${admitted.id}:stale`;
    const mismatchedFailure = await systemCommand("mutate-evidence-stage", {
      ...failureCommand,
      mutationId: "d".repeat(64),
      operation: { ...failureCommand.operation, dispatchId: staleDispatchId },
    });
    expect(mismatchedFailure.status).toBe(409);
    const committedFailure = await systemCommand(
      "mutate-evidence-stage",
      failureCommand
    );
    expect(committedFailure.status, await committedFailure.clone().text()).toBe(
      200
    );
    const failureReceipt = await Schema.decodeUnknownPromise(
      HouseholdMutateEvidenceStageResult
    )(await committedFailure.json());

    const cancelled = await getRuntime().dispatchFetch(
      `https://meal-planner.test/v1/recipe-import-intents/${admitted.id}/cancel`,
      {
        body: JSON.stringify({ expectedIntentVersion: 2 }),
        headers: {
          "content-type": "application/json",
          cookie,
          "idempotency-key": "cancel-stage-race",
        },
        method: "POST",
      }
    );
    expect(cancelled.status, await cancelled.text()).toBe(200);

    const replay = await systemCommand("mutate-evidence-stage", claimCommand);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(HouseholdMutateEvidenceStageResult)(
        await replay.json()
      )
    ).toEqual(claimReceipt);

    const newClaim = await systemCommand("mutate-evidence-stage", {
      ...claimCommand,
      mutationId: "b".repeat(64),
    });
    expect(newClaim.status).toBe(400);
    const failureReplay = await systemCommand(
      "mutate-evidence-stage",
      failureCommand
    );
    expect(failureReplay.status, await failureReplay.clone().text()).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(HouseholdMutateEvidenceStageResult)(
        await failureReplay.json()
      )
    ).toEqual(failureReceipt);
    const terminalFailure = await systemCommand("mutate-evidence-stage", {
      ...failureCommand,
      mutationId: "e".repeat(64),
    });
    expect(terminalFailure.status).toBe(400);
  }, 30_000);

  it("physically isolates household evidence routing", async () => {
    const householdA = await admitResolvedEvidenceImport({
      label: "Evidence Isolation A",
      mutationId: "b".repeat(64),
      videoId: "7000000000000000105",
    });
    const cookieB = await signUp("Evidence Isolation B");
    const organizationB = await createOrganization(
      "Evidence Isolation B Household",
      cookieB
    );
    const result = evidenceRetentionResult({
      acquiredAt: new Date(Date.now() + 60_000),
      generation: 1,
      intentId: householdA.admitted.id,
    });
    const mutationId = "c".repeat(64);
    const crossHouseholdResponse = await systemCommand(
      "commit-acquisition-evidence",
      {
        acquisitionAttemptGeneration: 1,
        admission: {
          ...householdA.admission,
          organizationId: organizationB.id,
        },
        expectedGeneration: 1,
        intentId: householdA.admitted.id,
        mutationId,
        result,
      }
    );
    expect(crossHouseholdResponse.status).toBe(404);

    const ownerResponse = await systemCommand("commit-acquisition-evidence", {
      acquisitionAttemptGeneration: 1,
      admission: householdA.admission,
      expectedGeneration: 1,
      intentId: householdA.admitted.id,
      mutationId,
      result,
    });
    expect(ownerResponse.status, await ownerResponse.text()).toBe(200);
  }, 30_000);

  it("returns the same private receipt on retry and rejects a conflicting replay without mutation", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Evidence Replay Member",
      mutationId: "d".repeat(64),
      videoId: "7000000000000000106",
    });
    const result = evidenceRetentionResult({
      acquiredAt: new Date(Date.now() + 60_000),
      generation: 1,
      intentId: admitted.id,
    });
    const command = {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "e".repeat(64),
      result,
    } as const;
    const firstResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(firstResponse.status).toBe(200);
    const firstReceipt = await Schema.decodeUnknownPromise(
      HouseholdCommitAcquisitionEvidenceResult
    )(await firstResponse.json());
    expect(JSON.stringify(firstReceipt)).not.toMatch(
      /imports\/|sha256|deleteAt/u
    );

    const retryResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(retryResponse.status).toBe(200);
    const retryReceipt = await Schema.decodeUnknownPromise(
      HouseholdCommitAcquisitionEvidenceResult
    )(await retryResponse.json());
    expect(retryReceipt).toEqual(firstReceipt);

    const conflictingResponse = await systemCommand(
      "commit-acquisition-evidence",
      {
        ...command,
        result: {
          ...result,
          references: [
            { ...result.references[0], sha256: "f".repeat(64) },
            result.references[1],
          ],
        },
      }
    );
    expect(conflictingResponse.status).toBe(409);

    const afterConflictResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(afterConflictResponse.status).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(
        HouseholdCommitAcquisitionEvidenceResult
      )(await afterConflictResponse.json())
    ).toEqual(firstReceipt);
  }, 30_000);

  it("persists household evidence receipts across a real runtime restart", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Evidence Restart Member",
      mutationId: "1".repeat(64),
      videoId: "7000000000000000107",
    });
    const expiresAtEpochMs = Date.now() + 2000;
    const command = {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "2".repeat(64),
      result: evidenceRetentionResult({
        acquiredAt: new Date(expiresAtEpochMs - 604_800_000),
        generation: 1,
        intentId: admitted.id,
      }),
    } as const;
    const firstResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(firstResponse.status).toBe(200);
    const receipt = await Schema.decodeUnknownPromise(
      HouseholdCommitAcquisitionEvidenceResult
    )(await firstResponse.json());

    await delay(Math.max(0, expiresAtEpochMs - Date.now() + 100));
    await restartRuntime();

    const replayResponse = await systemCommand(
      "commit-acquisition-evidence",
      command
    );
    expect(replayResponse.status).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(
        HouseholdCommitAcquisitionEvidenceResult
      )(await replayResponse.json())
    ).toEqual(receipt);

    const expiredFirstWrite = await systemCommand(
      "commit-acquisition-evidence",
      {
        ...command,
        mutationId: "0".repeat(64),
      }
    );
    expect(expiredFirstWrite.status).toBe(400);
  }, 30_000);

  it("rejects invalid retention without mutation and accepts the corrected deadline", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Evidence Retention Member",
      mutationId: "3".repeat(64),
      videoId: "7000000000000000108",
    });
    const acquiredAt = new Date(Date.now() + 60_000);
    const result = evidenceRetentionResult({
      acquiredAt,
      generation: 1,
      intentId: admitted.id,
    });
    const mutationId = "4".repeat(64);
    const invalidDeleteAt = new Date(
      acquiredAt.getTime() + 604_800_001
    ).toISOString();
    const invalidResponse = await systemCommand("commit-acquisition-evidence", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId,
      result: {
        ...result,
        references: result.references.map((reference) => ({
          ...reference,
          deleteAt: invalidDeleteAt,
        })),
      },
    });
    expect(invalidResponse.status).toBe(400);

    const correctedResponse = await systemCommand(
      "commit-acquisition-evidence",
      {
        acquisitionAttemptGeneration: 1,
        admission,
        expectedGeneration: 1,
        intentId: admitted.id,
        mutationId,
        result,
      }
    );
    expect(correctedResponse.status, await correctedResponse.text()).toBe(200);
  }, 30_000);

  it("records a missing R2 observation without weakening committed integrity metadata", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Missing Evidence Member",
      mutationId: "5".repeat(64),
      videoId: "7000000000000000109",
    });
    const evidence = evidenceRetentionResult({
      acquiredAt: new Date(Date.now() + 60_000),
      generation: 1,
      intentId: admitted.id,
    });
    const committed = await systemCommand("commit-acquisition-evidence", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "6".repeat(64),
      result: evidence,
    });
    expect(committed.status, await committed.text()).toBe(200);

    const [media] = evidence.references;
    const observed = await systemCommand("observe-evidence-reference", {
      admission,
      availability: "missing",
      event: {
        action: "IntegrityProbe",
        eventTime: "2026-08-22T11:00:00.000Z",
      },
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "7".repeat(64),
      reference: {
        key: media.key,
        kind: media.kind,
        sha256: media.sha256,
      },
    });
    const observedBody = await observed.text();
    expect(observed.status, observedBody).toBe(200);
    const missingReceipt = await Schema.decodeUnknownPromise(
      HouseholdObserveEvidenceReferenceResult
    )(JSON.parse(observedBody));
    expect(missingReceipt).toMatchObject({
      availability: "missing",
      executionGeneration: 1,
      intentId: admitted.id,
      kind: "original_media",
      observationOrdinal: 1,
    });
    expect(JSON.stringify(missingReceipt)).not.toMatch(
      /imports\/|sha256|deleteAt/u
    );

    const retry = await systemCommand("observe-evidence-reference", {
      admission,
      availability: "missing",
      event: {
        action: "IntegrityProbe",
        eventTime: "2026-08-22T11:00:00.000Z",
      },
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "7".repeat(64),
      reference: {
        key: media.key,
        kind: media.kind,
        sha256: media.sha256,
      },
    });
    expect(retry.status).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(
        HouseholdObserveEvidenceReferenceResult
      )(await retry.json())
    ).toEqual(missingReceipt);

    const forged = await systemCommand("observe-evidence-reference", {
      admission,
      availability: "missing",
      event: {
        action: "IntegrityProbe",
        eventTime: "2026-08-22T11:01:00.000Z",
      },
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "8".repeat(64),
      reference: {
        key: media.key,
        kind: media.kind,
        sha256: "9".repeat(64),
      },
    });
    expect(forged.status).toBe(400);

    const lateStaleDeletion = await systemCommand(
      "observe-evidence-reference",
      {
        admission,
        availability: "deleted",
        event: {
          action: "LifecycleDeletion",
          eventTime: "2026-08-22T11:02:00.000Z",
        },
        expectedGeneration: 2,
        intentId: admitted.id,
        mutationId: "9".repeat(64),
        reference: {
          key: media.key,
          kind: media.kind,
          sha256: media.sha256,
        },
      }
    );
    expect(lateStaleDeletion.status).toBe(409);

    const deletion = await systemCommand("observe-evidence-reference", {
      admission,
      availability: "deleted",
      event: {
        action: "LifecycleDeletion",
        eventTime: "2026-08-22T11:02:00.000Z",
      },
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "9".repeat(64),
      reference: {
        key: media.key,
        kind: media.kind,
        sha256: media.sha256,
      },
    });
    expect(deletion.status).toBe(200);
    expect(await deletion.json()).toMatchObject({
      availability: "deleted",
      observationOrdinal: 2,
    });
  }, 30_000);

  it("rejects source-mixed evidence reference wire shapes", async () => {
    const intentId = "00000000-0000-4000-8000-000000000134";
    const manifestSha256 = "7".repeat(64);
    const completedAt = new Date("2026-08-22T12:10:00.000Z");
    const deleteAt = new Date("2026-08-29T12:10:00.000Z");
    const manifestKey = `imports/${intentId}/carousel/v1/generations/1/manifest.json`;

    const referenceFields = {
      availability: "available" as const,
      byteLength: 1,
      deleteAt: deleteAt.toISOString(),
      observationOrdinal: 0,
      sha256: "a".repeat(64),
    };
    const original = {
      ...referenceFields,
      key: `imports/${intentId}/acquisition/v1/generations/1/original.mp4`,
      kind: "original_media" as const,
    };
    const acquisition = {
      ...referenceFields,
      key: `imports/${intentId}/acquisition/v1/generations/1/manifest.json`,
      kind: "acquisition_manifest" as const,
    };
    const speech = {
      ...referenceFields,
      key: `imports/${intentId}/speech/v1/generations/1/transcript.json`,
      kind: "speech_transcript" as const,
    };
    const visual = {
      ...referenceFields,
      key: `imports/${intentId}/visual/v1/generations/1/manifest.json`,
      kind: "visual_manifest" as const,
    };
    const resultIdentity = {
      committedAt: completedAt.toISOString(),
      executionGeneration: 1,
      intentId,
    };

    await expect(
      Schema.decodeUnknownPromise(HouseholdReadEvidenceReferencesResult)({
        ...resultIdentity,
        references: [original, acquisition, speech, visual],
      })
    ).resolves.toBeDefined();
    await expect(
      Schema.decodeUnknownPromise(HouseholdReadEvidenceReferencesResult)({
        ...resultIdentity,
        references: [original, acquisition, visual, speech],
      })
    ).rejects.toBeDefined();
    await expect(
      Schema.decodeUnknownPromise(HouseholdReadEvidenceReferencesResult)({
        ...resultIdentity,
        references: [
          original,
          {
            ...referenceFields,
            key: manifestKey,
            kind: "carousel_manifest",
            sha256: manifestSha256,
          },
        ],
      })
    ).rejects.toBeDefined();
  }, 30_000);

  it("rejects wrong-source evidence commands before authoring household evidence", async () => {
    const carousel = await admitResolvedEvidenceImport({
      label: "Wrong Acquisition Source Member",
      mutationId: "b".repeat(64),
      sourceKind: "carousel",
      videoId: "7000000000000000135",
    });
    const acquisitionMutationId = "c".repeat(64);
    const wrongAcquisition = await systemCommand(
      "commit-acquisition-evidence",
      {
        acquisitionAttemptGeneration: 1,
        admission: carousel.admission,
        expectedGeneration: 1,
        intentId: carousel.admitted.id,
        mutationId: acquisitionMutationId,
        result: evidenceRetentionResult({
          acquiredAt: new Date(Date.now() + 60_000),
          generation: 1,
          intentId: carousel.admitted.id,
        }),
      }
    );
    expect(wrongAcquisition.status).toBe(400);
    await expect(wrongAcquisition.json()).resolves.toMatchObject({
      reason: "illegal_transition",
      rejected: true,
    });
    await expect(
      readEvidenceReferences(carousel.admission, carousel.admitted.id)
    ).resolves.toBeNull();
    const emptyCarouselStage = await systemCommand("read-evidence-stage", {
      admission: carousel.admission,
      expectedGeneration: 1,
      intentId: carousel.admitted.id,
      stage: "carousel",
    });
    expect(emptyCarouselStage.status).toBe(200);
    await expect(emptyCarouselStage.json()).resolves.toBeNull();

    const correctedCarouselClaim = await systemCommand(
      "mutate-evidence-stage",
      {
        acquisitionAttemptGeneration: 1,
        admission: carousel.admission,
        expectedGeneration: 1,
        inputFingerprint: "d".repeat(64),
        intentId: carousel.admitted.id,
        mutationId: acquisitionMutationId,
        operation: {
          _tag: "Claim",
          dispatchId: `carousel:${carousel.admitted.id}:1`,
          stage: "carousel",
          startedAt: new Date(Date.now() + 120_000).toISOString(),
        },
      }
    );
    expect(
      correctedCarouselClaim.status,
      await correctedCarouselClaim.clone().text()
    ).toBe(200);

    const video = await admitResolvedEvidenceImport({
      label: "Wrong Stage Source Member",
      mutationId: "e".repeat(64),
      sourceKind: "video",
      videoId: "7000000000000000136",
    });
    const stageMutationId = "f".repeat(64);
    const stageFingerprint = "0".repeat(64);
    const wrongStage = await systemCommand("mutate-evidence-stage", {
      acquisitionAttemptGeneration: 1,
      admission: video.admission,
      expectedGeneration: 1,
      inputFingerprint: stageFingerprint,
      intentId: video.admitted.id,
      mutationId: stageMutationId,
      operation: {
        _tag: "Claim",
        dispatchId: `carousel:${video.admitted.id}:1`,
        stage: "carousel",
        startedAt: new Date(Date.now() + 180_000).toISOString(),
      },
    });
    expect(wrongStage.status).toBe(400);
    await expect(wrongStage.json()).resolves.toMatchObject({
      reason: "illegal_transition",
      rejected: true,
    });
    await expect(
      readEvidenceReferences(video.admission, video.admitted.id)
    ).resolves.toBeNull();
    const emptyVideoStage = await systemCommand("read-evidence-stage", {
      admission: video.admission,
      expectedGeneration: 1,
      intentId: video.admitted.id,
      stage: "carousel",
    });
    expect(emptyVideoStage.status).toBe(200);
    await expect(emptyVideoStage.json()).resolves.toBeNull();

    const correctedSpeechClaim = await systemCommand("mutate-evidence-stage", {
      acquisitionAttemptGeneration: 1,
      admission: video.admission,
      expectedGeneration: 1,
      inputFingerprint: stageFingerprint,
      intentId: video.admitted.id,
      mutationId: stageMutationId,
      operation: {
        _tag: "Claim",
        dispatchId: `speech:${video.admitted.id}:1`,
        stage: "speech",
        startedAt: new Date(Date.now() + 240_000).toISOString(),
      },
    });
    expect(
      correctedSpeechClaim.status,
      await correctedSpeechClaim.clone().text()
    ).toBe(200);
  }, 30_000);

  it("rejects a forged cross-organization session before private routing", async () => {
    const cookieA = await signUp("Boundary A");
    const cookieB = await signUp("Boundary B");
    const organizationB = await createOrganization("Boundary B Home", cookieB);
    const sessionResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/api/auth/get-session",
      { headers: { cookie: cookieA } }
    );
    const session = await Schema.decodeUnknownPromise(SessionResponse)(
      await sessionResponse.json()
    );
    const authDatabase = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    await authDatabase
      .update(authSchema.session)
      .set({ activeOrganizationId: organizationB.id })
      .where(eq(authSchema.session.id, session.session.id));

    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/recipe-import-intents",
      {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@forged/video/7000000000000000000",
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie: cookieA,
          "idempotency-key": "forged-household-admission",
        },
        method: "POST",
      }
    );
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain(
      organizationB.id
    );
  });

  it("checkpoints household-owned terminal identities without shared-D1 evidence rows", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Household Terminal Ownership",
      mutationId: "d".repeat(64),
      videoId: "7000000000000000101",
    });
    const acquiredAt = new Date(Date.now() + 60_000);
    const acquisition = await systemCommand("commit-acquisition-evidence", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "e".repeat(64),
      result: evidenceRetentionResult({
        acquiredAt,
        generation: 1,
        intentId: admitted.id,
      }),
    });
    expect(acquisition.status, await acquisition.text()).toBe(200);

    const identities = [
      { failureCode: "transcription_failed", stage: "speech" },
      { failureCode: "visual_extraction_failed", stage: "visual" },
      { failureCode: "provider_error", stage: "extraction" },
    ] as const;
    const stages = await Promise.all(
      identities.map(async (identity, ordinal) => {
        const fingerprint = String(ordinal + 1).repeat(64);
        const dispatchId =
          identity.stage === "extraction"
            ? fingerprint
            : `${identity.stage}:${admitted.id}:1`;
        const extractionContext =
          identity.stage === "extraction"
            ? {
                descriptor: {
                  model: "fixture-v1",
                  provider: "deterministic_fake" as const,
                  version: "schema-1",
                },
                evidenceFingerprint: "a".repeat(64),
                sourceMediaSha256: "b".repeat(64),
                transcriptSha256: "c".repeat(64),
                visualManifestSha256: "d".repeat(64),
              }
            : undefined;
        const claim = await systemCommand("mutate-evidence-stage", {
          acquisitionAttemptGeneration: 1,
          admission,
          expectedGeneration: 1,
          inputFingerprint: fingerprint,
          intentId: admitted.id,
          mutationId: String(ordinal + 4).repeat(64),
          operation: {
            _tag: "Claim",
            dispatchId,
            extractionContext,
            stage: identity.stage,
            startedAt: new Date(
              acquiredAt.getTime() + ordinal + 1
            ).toISOString(),
          },
        });
        expect(claim.status, await claim.text()).toBe(200);
        const failedAt = new Date(
          acquiredAt.getTime() + identities.length + ordinal + 1
        ).toISOString();
        const failure = await systemCommand("mutate-evidence-stage", {
          acquisitionAttemptGeneration: 1,
          admission,
          expectedGeneration: 1,
          inputFingerprint: fingerprint,
          intentId: admitted.id,
          mutationId: String(ordinal + 7).repeat(64),
          operation: {
            _tag: "Fail",
            completedAt: failedAt,
            dispatchId,
            failureCode: identity.failureCode,
            recovery: "operator_review",
            stage: identity.stage,
          },
        });
        expect(failure.status, await failure.text()).toBe(200);
        const stageResponse = await systemCommand("read-evidence-stage", {
          admission,
          expectedGeneration: 1,
          intentId: admitted.id,
          stage: identity.stage,
        });
        expect(stageResponse.status, await stageResponse.clone().text()).toBe(
          200
        );
        const stage = await Schema.decodeUnknownPromise(
          HouseholdReadEvidenceStageResult
        )(await stageResponse.json());
        expect(stage).toMatchObject({
          dispatchId,
          inputFingerprint: fingerprint,
          outcome: "Failed",
        });
        if (stage === null) {
          throw new Error("Expected household terminal stage authority.");
        }
        return { identity, stage };
      })
    );

    expect(stages).toHaveLength(3);
    await Promise.all(
      stages.map(async ({ identity, stage }) => {
        const checkpointResponse = await systemCommand(
          "read-terminal-checkpoint",
          {
            admission,
            expectedGeneration: 1,
            intentId: admitted.id,
            ownershipId: stage.dispatchId,
            stage: identity.stage,
          }
        );
        expect(
          checkpointResponse.status,
          await checkpointResponse.clone().text()
        ).toBe(200);
        const checkpoint = await Schema.decodeUnknownPromise(
          HouseholdReadImportTerminalCheckpointResult
        )(await checkpointResponse.json());
        expect(checkpoint).toMatchObject({
          executionGeneration: 1,
          failureCode: identity.failureCode,
          intentId: admitted.id,
          ownershipId: stage.dispatchId,
          stage: identity.stage,
        });
      })
    );
    const database = await getRuntime().getD1Database(
      "ProviderAccountingDatabase",
      "provider-recovery"
    );
    const providerAccountingTables = await database
      .prepare(
        `SELECT name
           FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE '_cf_%'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name`
      )
      .all();
    expect(providerAccountingTables.results).toEqual([
      { name: "provider_accounting_budgets" },
      { name: "provider_accounting_conservative_settlements" },
      { name: "provider_accounting_dispatches" },
      { name: "provider_accounting_recipe_replay_values" },
      { name: "provider_accounting_reconciliations" },
    ]);
  });

  it.each([
    { stage: "speech", videoId: "7000000000000000143" },
    { stage: "visual", videoId: "7000000000000000144" },
  ] as const)(
    "replays the exact first $stage failure after a changed-clock lost response",
    async ({ stage, videoId }) => {
      const { admission, admitted } = await admitResolvedEvidenceImport({
        label: `Household ${stage} Failure Replay`,
        mutationId: (stage === "speech" ? "3" : "4").repeat(64),
        videoId,
      });
      const acquisition = await systemCommand("commit-acquisition-evidence", {
        acquisitionAttemptGeneration: 1,
        admission,
        expectedGeneration: 1,
        intentId: admitted.id,
        mutationId: (stage === "speech" ? "5" : "6").repeat(64),
        result: evidenceRetentionResult({
          acquiredAt: new Date(Date.now() + 60_000),
          generation: 1,
          intentId: admitted.id,
        }),
      });
      expect(acquisition.status, await acquisition.clone().text()).toBe(200);
      const dispatchId = `${stage}:${admitted.id}:1`;
      const completedAt = new Date(Date.now() + 120_000).toISOString();
      const command = {
        acquisitionGeneration: 1,
        admission,
        canonicalSourceId: `tiktok:video:${videoId}`,
        completedAt,
        correlationId:
          stage === "speech"
            ? "00000000-0000-4000-8000-000000000197"
            : "00000000-0000-4000-8000-000000000198",
        dispatchId,
        executionGeneration: 1,
        inputFingerprint: (stage === "speech" ? "7" : "8").repeat(64),
        intentId: admitted.id,
        stage,
      } as const;
      const first = await providerTerminalAttemptCommand(command);
      expect(first.status, await first.clone().text()).toBe(200);
      const firstReceipt = await first.json();
      expect(firstReceipt).toMatchObject({
        completedAt,
        failureCode: "outcome_unknown",
        ownershipId: dispatchId,
        stage,
      });

      const replay = await providerTerminalAttemptCommand({
        ...command,
        completedAt: new Date(Date.now() + 240_000).toISOString(),
      });
      expect(replay.status, await replay.clone().text()).toBe(200);
      expect(await replay.json()).toEqual(firstReceipt);

      const providerState = await getRuntime().getKVNamespace(
        "PROVIDER_RECOVERY_RESULTS",
        "provider-recovery"
      );
      await expect(
        providerState.get(`provider-attempt-calls:${dispatchId}`)
      ).resolves.toBe("1");
      const stageResponse = await systemCommand("read-evidence-stage", {
        admission,
        expectedGeneration: 1,
        intentId: admitted.id,
        stage,
      });
      expect(stageResponse.status, await stageResponse.clone().text()).toBe(
        200
      );
      await expect(stageResponse.json()).resolves.toMatchObject({
        completedAt,
        failureCode: "outcome_unknown",
        outcome: "Failed",
      });
    },
    30_000
  );

  it("replays household speech recovery after the external restart fails", async () => {
    const fixture = await prepareUnknownSpeechTerminal({
      label: "Household Speech Recovery Failure Replay",
      mutationIds: ["1".repeat(64), "3".repeat(64), "4".repeat(64)],
      videoId: "7000000000000000107",
    });
    const failedRestart = await terminalSettlementCommand(
      fixture.recoveryCommand,
      {
        speechRestart: "fail",
      }
    );
    expect(failedRestart.status).toBe(409);
    const restartState = await getRuntime().getKVNamespace(
      "PROVIDER_RECOVERY_RESULTS",
      "provider-recovery"
    );
    await expect(
      restartState.get(`speech-restart:${fixture.intentId}`)
    ).resolves.toBeNull();
    const preparedStage = await readSpeechStage(fixture);
    expect(preparedStage).toMatchObject({
      dispatchId: fixture.recoveryDispatchId,
      inputFingerprint: fixture.inputFingerprint,
      outcome: "Dispatching",
    });

    const staleGeneration = await terminalSettlementCommand({
      ...fixture.recoveryCommand,
      executionGeneration: 2,
    });
    expect(staleGeneration.status).toBe(409);
    const staleOwnership = await terminalSettlementCommand({
      ...fixture.recoveryCommand,
      dispatchId: `${fixture.dispatchId}:stale`,
    });
    expect(staleOwnership.status).toBe(409);
    expect(await readSpeechStage(fixture)).toEqual(preparedStage);

    const replay = await terminalSettlementCommand(fixture.recoveryCommand);
    expect(replay.status, await replay.clone().text()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      acquisitionGeneration: fixture.generation,
      importId: fixture.intentId,
      outcome: "speech_recovery_activated",
      recoveryDispatchId: fixture.recoveryDispatchId,
    });
    expect(await readSpeechStage(fixture)).toEqual(preparedStage);
  }, 30_000);

  it("replays household speech recovery after a completed restart response is lost", async () => {
    const fixture = await prepareUnknownSpeechTerminal({
      label: "Household Speech Recovery Lost Response",
      mutationIds: ["5".repeat(64), "6".repeat(64), "7".repeat(64)],
      videoId: "7000000000000000108",
    });
    const recoveredResponse = await terminalSettlementCommand(
      fixture.recoveryCommand,
      { speechRestart: "terminal-then-fail" }
    );
    expect(
      recoveredResponse.status,
      await recoveredResponse.clone().text()
    ).toBe(200);
    await expect(recoveredResponse.json()).resolves.toMatchObject({
      acquisitionGeneration: fixture.generation,
      importId: fixture.intentId,
      outcome: "speech_recovery_activated",
      recoveryDispatchId: fixture.recoveryDispatchId,
    });
    const restartState = await getRuntime().getKVNamespace(
      "PROVIDER_RECOVERY_RESULTS",
      "provider-recovery"
    );
    await expect(
      restartState.get(`speech-restart:${fixture.intentId}`)
    ).resolves.toBe("complete");
    await expect(
      restartState.get(`speech-restart-calls:${fixture.intentId}`)
    ).resolves.toBe("1");
    const preparedStage = await readSpeechStage(fixture);
    expect(preparedStage).toMatchObject({
      dispatchId: fixture.recoveryDispatchId,
      outcome: "Failed",
    });

    const replay = await terminalSettlementCommand(fixture.recoveryCommand);
    expect(replay.status, await replay.clone().text()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      acquisitionGeneration: fixture.generation,
      importId: fixture.intentId,
      outcome: "speech_recovery_activated",
      recoveryDispatchId: fixture.recoveryDispatchId,
    });
    expect(await readSpeechStage(fixture)).toEqual(preparedStage);
    await expect(
      restartState.get(`speech-restart-calls:${fixture.intentId}`)
    ).resolves.toBe("1");
  }, 30_000);

  it("returns one exact household speech recovery across concurrent replays", async () => {
    const fixture = await prepareUnknownSpeechTerminal({
      label: "Household Concurrent Speech Recovery Replay",
      mutationIds: ["8".repeat(64), "9".repeat(64), "a".repeat(64)],
      videoId: "7000000000000000109",
    });
    const [first, second] = await Promise.all([
      terminalSettlementCommand(fixture.recoveryCommand),
      terminalSettlementCommand(fixture.recoveryCommand),
    ]);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(second.status, await second.clone().text()).toBe(200);
    const firstResult = await first.json();
    expect(await second.json()).toEqual(firstResult);
    expect(firstResult).toMatchObject({
      acquisitionGeneration: fixture.generation,
      importId: fixture.intentId,
      outcome: "speech_recovery_activated",
      recoveryDispatchId: fixture.recoveryDispatchId,
    });
    expect(await readSpeechStage(fixture)).toMatchObject({
      dispatchId: fixture.recoveryDispatchId,
      inputFingerprint: fixture.inputFingerprint,
      outcome: "Dispatching",
    });
    const restartState = await getRuntime().getKVNamespace(
      "PROVIDER_RECOVERY_RESULTS",
      "provider-recovery"
    );
    await expect(
      restartState.get(`speech-restart-calls:${fixture.intentId}`)
    ).resolves.toBe("1");
  }, 30_000);

  it("keeps execution generation one across acquisition attempt two and successive speech recovery", async () => {
    const fixture = await prepareUnknownSpeechTerminal({
      acquisitionGeneration: 2,
      label: "Household Speech Recovery Execution",
      mutationIds: ["b".repeat(64), "c".repeat(64), "d".repeat(64)],
      videoId: "7000000000000000110",
    });
    const firstRecovery = await terminalSettlementCommand(
      fixture.recoveryCommand
    );
    expect(firstRecovery.status, await firstRecovery.clone().text()).toBe(200);

    const firstAttempt = await providerTerminalAttemptCommand({
      acquisitionGeneration: fixture.acquisitionGeneration,
      admission: fixture.admission,
      canonicalSourceId: fixture.canonicalSourceId,
      correlationId: "00000000-0000-4000-8000-000000000189",
      dispatchId: fixture.recoveryDispatchId,
      executionGeneration: fixture.executionGeneration,
      inputFingerprint: fixture.inputFingerprint,
      intentId: fixture.intentId,
      stage: "speech",
    });
    expect(firstAttempt.status, await firstAttempt.clone().text()).toBe(200);
    await expect(firstAttempt.json()).resolves.toMatchObject({
      failureCode: "outcome_unknown",
      ownershipId: fixture.recoveryDispatchId,
      stage: "speech",
    });

    await settleUnknownProviderBudget({
      dispatchId: fixture.recoveryDispatchId,
      importId: fixture.intentId,
      providerStageId: "speech-transcription",
    });
    const settlement = await terminalSettlementCommand({
      dispatchId: fixture.recoveryDispatchId,
      importId: fixture.intentId,
      operation: "settle_speech_unknown",
    });
    expect(settlement.status, await settlement.clone().text()).toBe(200);
    const secondRecovery = await terminalSettlementCommand({
      acquisitionGeneration: fixture.acquisitionGeneration,
      dispatchId: fixture.recoveryDispatchId,
      executionGeneration: fixture.executionGeneration,
      importId: fixture.intentId,
      operation: "prepare_speech_recovery",
      organizationId: fixture.organizationId,
    });
    expect(secondRecovery.status, await secondRecovery.clone().text()).toBe(
      200
    );
    const recoveryTwoDispatchId = `${fixture.dispatchId}:recovery:2`;
    await expect(secondRecovery.json()).resolves.toMatchObject({
      outcome: "speech_recovery_activated",
      recoveryDispatchId: recoveryTwoDispatchId,
    });

    const secondAttempt = await providerTerminalAttemptCommand({
      acquisitionGeneration: fixture.acquisitionGeneration,
      admission: fixture.admission,
      canonicalSourceId: fixture.canonicalSourceId,
      correlationId: "00000000-0000-4000-8000-000000000190",
      dispatchId: recoveryTwoDispatchId,
      executionGeneration: fixture.executionGeneration,
      inputFingerprint: fixture.inputFingerprint,
      intentId: fixture.intentId,
      stage: "speech",
    });
    expect(secondAttempt.status, await secondAttempt.clone().text()).toBe(200);
    await expect(secondAttempt.json()).resolves.toMatchObject({
      failureCode: "outcome_unknown",
      ownershipId: recoveryTwoDispatchId,
      stage: "speech",
    });
  }, 30_000);

  it("settles and executes two household visual recovery attempts after provider ambiguity", async () => {
    const videoId = "7000000000000000111";
    const { admission, admitted, organization } =
      await admitResolvedEvidenceImport({
        label: "Household Visual Recovery Execution",
        mutationId: "e".repeat(64),
        videoId,
      });
    const generation = 1;
    const canonicalSourceId = `tiktok:video:${videoId}`;
    const inputFingerprint = "f".repeat(64);
    const dispatchId = `visual:${admitted.id}:${generation}`;
    const originalAttempt = await providerTerminalAttemptCommand({
      acquisitionGeneration: generation,
      admission,
      canonicalSourceId,
      correlationId: "00000000-0000-4000-8000-000000000191",
      dispatchId,
      executionGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      stage: "visual",
    });
    expect(originalAttempt.status, await originalAttempt.clone().text()).toBe(
      200
    );
    const originalReplay = await providerTerminalAttemptCommand({
      acquisitionGeneration: generation,
      admission,
      canonicalSourceId,
      correlationId: "00000000-0000-4000-8000-000000000191",
      dispatchId,
      executionGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      stage: "visual",
    });
    expect(originalReplay.status, await originalReplay.clone().text()).toBe(
      200
    );
    const providerState = await getRuntime().getKVNamespace(
      "PROVIDER_RECOVERY_RESULTS",
      "provider-recovery"
    );
    await expect(
      providerState.get(`provider-attempt-calls:${dispatchId}`)
    ).resolves.toBe("1");
    await settleUnknownProviderBudget({
      dispatchId,
      importId: admitted.id,
      providerStageId: "visual-evidence",
    });
    const originalSettlement = await terminalSettlementCommand({
      dispatchId,
      importId: admitted.id,
      operation: "settle_visual_unknown",
    });
    expect(
      originalSettlement.status,
      await originalSettlement.clone().text()
    ).toBe(200);
    const firstRecoveryCommand = {
      acquisitionGeneration: generation,
      dispatchId,
      executionGeneration: 1,
      importId: admitted.id,
      operation: "prepare_visual_recovery",
      organizationId: organization.id,
    } as const;
    const [firstRecovery, concurrentRecovery] = await Promise.all([
      terminalSettlementCommand(firstRecoveryCommand),
      terminalSettlementCommand(firstRecoveryCommand),
    ]);
    expect(firstRecovery.status, await firstRecovery.clone().text()).toBe(200);
    expect(
      concurrentRecovery.status,
      await concurrentRecovery.clone().text()
    ).toBe(200);
    const recoveryOneDispatchId = `${dispatchId}:recovery:1`;
    const firstRecoveryReceipt = await firstRecovery.json();
    expect(await concurrentRecovery.json()).toEqual(firstRecoveryReceipt);
    expect(firstRecoveryReceipt).toMatchObject({
      outcome: "visual_recovery_activated",
      recoveryDispatchId: recoveryOneDispatchId,
    });

    const [staleGeneration, staleDispatch, staleFingerprint] =
      await Promise.all([
        providerTerminalAttemptCommand({
          acquisitionGeneration: generation,
          admission,
          canonicalSourceId,
          correlationId: "00000000-0000-4000-8000-000000000192",
          dispatchId: recoveryOneDispatchId,
          executionGeneration: 2,
          inputFingerprint,
          intentId: admitted.id,
          stage: "visual",
        }),
        providerTerminalAttemptCommand({
          acquisitionGeneration: generation,
          admission,
          canonicalSourceId,
          correlationId: "00000000-0000-4000-8000-000000000192",
          dispatchId: `${recoveryOneDispatchId}:stale`,
          executionGeneration: 1,
          inputFingerprint,
          intentId: admitted.id,
          stage: "visual",
        }),
        providerTerminalAttemptCommand({
          acquisitionGeneration: generation,
          admission,
          canonicalSourceId,
          correlationId: "00000000-0000-4000-8000-000000000192",
          dispatchId: recoveryOneDispatchId,
          executionGeneration: 1,
          inputFingerprint: "0".repeat(64),
          intentId: admitted.id,
          stage: "visual",
        }),
      ]);
    expect(staleGeneration.status).toBe(409);
    expect(staleDispatch.status).toBe(409);
    expect(staleFingerprint.status).toBe(409);
    const unchangedStageResponse = await systemCommand("read-evidence-stage", {
      admission,
      expectedGeneration: generation,
      intentId: admitted.id,
      stage: "visual",
    });
    expect(
      unchangedStageResponse.status,
      await unchangedStageResponse.clone().text()
    ).toBe(200);
    await expect(unchangedStageResponse.json()).resolves.toMatchObject({
      dispatchId: recoveryOneDispatchId,
      inputFingerprint,
      outcome: "Dispatching",
    });

    const firstAttempt = await providerTerminalAttemptCommand({
      acquisitionGeneration: generation,
      admission,
      canonicalSourceId,
      correlationId: "00000000-0000-4000-8000-000000000192",
      dispatchId: recoveryOneDispatchId,
      executionGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      stage: "visual",
    });
    expect(firstAttempt.status, await firstAttempt.clone().text()).toBe(200);
    await expect(firstAttempt.json()).resolves.toMatchObject({
      failureCode: "outcome_unknown",
      ownershipId: recoveryOneDispatchId,
      stage: "visual",
    });
    const firstAttemptReplay = await providerTerminalAttemptCommand({
      acquisitionGeneration: generation,
      admission,
      canonicalSourceId,
      correlationId: "00000000-0000-4000-8000-000000000192",
      dispatchId: recoveryOneDispatchId,
      executionGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      stage: "visual",
    });
    expect(
      firstAttemptReplay.status,
      await firstAttemptReplay.clone().text()
    ).toBe(200);
    await expect(
      providerState.get(`provider-attempt-calls:${recoveryOneDispatchId}`)
    ).resolves.toBe("1");
    await settleUnknownProviderBudget({
      dispatchId: recoveryOneDispatchId,
      importId: admitted.id,
      providerStageId: "visual-evidence",
    });
    const recoveryOneSettlement = await terminalSettlementCommand({
      dispatchId: recoveryOneDispatchId,
      importId: admitted.id,
      operation: "settle_visual_unknown",
    });
    expect(
      recoveryOneSettlement.status,
      await recoveryOneSettlement.clone().text()
    ).toBe(200);
    const secondRecovery = await terminalSettlementCommand({
      acquisitionGeneration: generation,
      dispatchId: recoveryOneDispatchId,
      executionGeneration: 1,
      importId: admitted.id,
      operation: "prepare_visual_recovery",
      organizationId: organization.id,
    });
    expect(secondRecovery.status, await secondRecovery.clone().text()).toBe(
      200
    );
    const recoveryTwoDispatchId = `${dispatchId}:recovery:2`;
    await expect(secondRecovery.json()).resolves.toMatchObject({
      outcome: "visual_recovery_activated",
      recoveryDispatchId: recoveryTwoDispatchId,
    });

    const secondAttempt = await providerTerminalAttemptCommand({
      acquisitionGeneration: generation,
      admission,
      canonicalSourceId,
      correlationId: "00000000-0000-4000-8000-000000000193",
      dispatchId: recoveryTwoDispatchId,
      executionGeneration: 1,
      inputFingerprint,
      intentId: admitted.id,
      stage: "visual",
    });
    expect(secondAttempt.status, await secondAttempt.clone().text()).toBe(200);
    await expect(secondAttempt.json()).resolves.toMatchObject({
      failureCode: "outcome_unknown",
      ownershipId: recoveryTwoDispatchId,
      stage: "visual",
    });
  }, 30_000);

  it.each([
    { mode: "absent", providerCalls: 1 },
    { mode: "present", providerCalls: 0 },
  ] as const)(
    "runs the installed visual ResumeDispatch seam with R2 $mode",
    async ({ mode, providerCalls }) => {
      const videoId =
        mode === "absent" ? "7000000000000000141" : "7000000000000000142";
      const { admission, admitted } = await admitResolvedEvidenceImport({
        canonicalSourceId: videoId,
        label: `Installed Visual Resume ${mode}`,
        mutationId: (mode === "absent" ? "1" : "2").repeat(64),
        videoId,
      });
      const response = await visualResumeCommand({
        acquisitionGeneration: 2,
        admission,
        canonicalSourceId: videoId,
        importId: admitted.id,
        mode,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        first: { _tag: "VisualEvidenceReady" },
        providerCalls,
        replay: { _tag: "VisualEvidenceReady" },
        stage: { outcome: "Completed" },
      });
    },
    30_000
  );

  it.each([
    { mode: "start_response_lost", suffix: "145" },
    { mode: "record_response_lost", suffix: "146" },
  ] as const)(
    "persists the original trace before a $mode ambiguity without duplicate provider work",
    async ({ mode, suffix }) => {
      const cookie = await signUp(`Dispatch Trace ${mode}`);
      const organization = await createOrganization(
        `Dispatch Trace ${mode} Household`,
        cookie
      );
      const correlationId = `00000000-0000-4000-8000-000000000${suffix}`;
      const response = await dispatchTraceDurabilityCommand({
        admission: {
          actor: { _tag: "Member", actorId: "9".repeat(64) },
          organizationId: organization.id,
        },
        mode,
        sourceUrl: `https://www.tiktok.com/@mealplanner/video/7000000000000000${suffix}`,
        trace: { correlationId },
      });
      expect(response.status, await response.clone().text()).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        originalTrace: { correlationId },
        providerCalls: 1,
        startCalls: 2,
        workflowIdentity: expect.stringMatching(
          /^import-acquisition:v1:[a-f\d]{64}$/u
        ),
      });
    },
    30_000
  );

  it("atomically prepares and persists a fenced household recipe recovery", async () => {
    const { admission, admitted } = await admitResolvedEvidenceImport({
      label: "Household Recipe Recovery",
      mutationId: "1".repeat(64),
      videoId: "7000000000000000102",
    });
    const predecessorFingerprint = "2".repeat(64);
    const evidenceFingerprint = "a".repeat(64);
    const predecessorClaim = await systemCommand("mutate-evidence-stage", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      inputFingerprint: predecessorFingerprint,
      intentId: admitted.id,
      mutationId: "4".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId: predecessorFingerprint,
        extractionContext: {
          descriptor: {
            model: "fixture-v1",
            provider: "deterministic_fake",
            version: "schema-1",
          },
          evidenceFingerprint,
          sourceMediaSha256: "b".repeat(64),
          transcriptSha256: "c".repeat(64),
          visualManifestSha256: "d".repeat(64),
        },
        stage: "extraction",
        startedAt: "2026-08-22T10:00:00.000Z",
      },
    });
    expect(predecessorClaim.status, await predecessorClaim.clone().text()).toBe(
      200
    );
    const predecessorFailure = await systemCommand("mutate-evidence-stage", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      inputFingerprint: predecessorFingerprint,
      intentId: admitted.id,
      mutationId: "5".repeat(64),
      operation: {
        _tag: "Fail",
        completedAt: "2026-08-22T10:01:00.000Z",
        dispatchId: predecessorFingerprint,
        failureCode: "provider_error",
        recovery: "operator_review",
        stage: "extraction",
      },
    });
    expect(
      predecessorFailure.status,
      await predecessorFailure.clone().text()
    ).toBe(200);

    const predecessorDispatchId = `recipe:${admitted.id}:1:${evidenceFingerprint}`;
    const failedIntent = await systemCommand("transition-lifecycle", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      transition: {
        _tag: "Fail",
        attemptIdentity: predecessorDispatchId,
        boundary: "recipe",
        code: "recipe_extraction_failed",
        message: "The recipe could not be extracted.",
        recovery: "contact_support",
      },
    });
    expect(failedIntent.status, await failedIntent.clone().text()).toBe(200);
    await expect(failedIntent.json()).resolves.toMatchObject({
      status: "failed",
    });
    const command = {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      mutationId: "6".repeat(64),
      predecessorDispatchId,
    } as const;
    const prepared = await systemCommand("prepare-recipe-recovery", command);
    expect(prepared.status, await prepared.clone().text()).toBe(200);
    const preparedReceipt = await Schema.decodeUnknownPromise(
      HouseholdPrepareRecipeRecoveryResult
    )(await prepared.json());
    expect(preparedReceipt).toMatchObject({
      attempt: {
        acquisitionGeneration: 1,
        importId: admitted.id,
        ordinal: 1,
        predecessorDispatchId,
        predecessorExtractionFingerprint: predecessorFingerprint,
        rootDispatchId: predecessorDispatchId,
        rootExtractionFingerprint: predecessorFingerprint,
      },
      outcome: "Prepared",
      receiptVersion: 1,
    });
    const recoveryFingerprint =
      preparedReceipt.attempt.currentExtractionFingerprint;

    const stageResponse = await systemCommand("read-evidence-stage", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      stage: "extraction",
    });
    expect(stageResponse.status, await stageResponse.clone().text()).toBe(200);
    await expect(stageResponse.json()).resolves.toMatchObject({
      dispatchId: recoveryFingerprint,
      failureCode: null,
      inputFingerprint: recoveryFingerprint,
      outcome: "Dispatching",
      result: null,
    });

    const replay = await systemCommand("prepare-recipe-recovery", command);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(HouseholdPrepareRecipeRecoveryResult)(
        await replay.json()
      )
    ).toEqual({ ...preparedReceipt, outcome: "Replay" });

    const stalePredecessor = await systemCommand("prepare-recipe-recovery", {
      ...command,
      mutationId: "8".repeat(64),
      predecessorDispatchId: `${predecessorDispatchId}:stale`,
    });
    expect(stalePredecessor.status, await stalePredecessor.clone().text()).toBe(
      409
    );

    const conflictingReplay = await systemCommand("prepare-recipe-recovery", {
      ...command,
      predecessorDispatchId: `${predecessorDispatchId}:conflict`,
    });
    expect(conflictingReplay.status).toBe(409);
    const afterConflict = await systemCommand("read-evidence-stage", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      stage: "extraction",
    });
    expect(afterConflict.status, await afterConflict.clone().text()).toBe(200);
    await expect(afterConflict.json()).resolves.toMatchObject({
      dispatchId: recoveryFingerprint,
      inputFingerprint: recoveryFingerprint,
      outcome: "Dispatching",
    });

    await restartRuntime();
    const persisted = await systemCommand("read-recipe-recovery-attempt", {
      admission,
      expectedGeneration: 1,
      intentId: admitted.id,
      selector: { _tag: "Latest", rootDispatchId: predecessorDispatchId },
    });
    expect(persisted.status, await persisted.clone().text()).toBe(200);
    expect(
      await Schema.decodeUnknownPromise(
        HouseholdReadRecipeRecoveryAttemptResult
      )(await persisted.json())
    ).toEqual(preparedReceipt.attempt);
  });

  it("accounts for unknown cost and independently starts household-only recovery", async () => {
    const { admission, admitted, organization } =
      await admitResolvedEvidenceImport({
        label: "Household Terminal Recovery",
        mutationId: "a".repeat(64),
        videoId: "7000000000000000103",
      });
    const generation = 1;
    const extractionFingerprint = "b".repeat(64);
    const evidenceFingerprint = "c".repeat(64);
    const dispatchId = `recipe:${admitted.id}:${generation}:${evidenceFingerprint}`;
    const claim = await systemCommand("mutate-evidence-stage", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: generation,
      inputFingerprint: extractionFingerprint,
      intentId: admitted.id,
      mutationId: "d".repeat(64),
      operation: {
        _tag: "Claim",
        dispatchId: extractionFingerprint,
        extractionContext: {
          descriptor: {
            model: "fixture-v1",
            provider: "deterministic_fake",
            version: "schema-1",
          },
          evidenceFingerprint,
          sourceMediaSha256: "e".repeat(64),
          transcriptSha256: "f".repeat(64),
          visualManifestSha256: "1".repeat(64),
        },
        stage: "extraction",
        startedAt: "2026-08-23T07:55:00.000Z",
      },
    });
    expect(claim.status, await claim.clone().text()).toBe(200);
    const failed = await systemCommand("mutate-evidence-stage", {
      acquisitionAttemptGeneration: 1,
      admission,
      expectedGeneration: generation,
      inputFingerprint: extractionFingerprint,
      intentId: admitted.id,
      mutationId: "2".repeat(64),
      operation: {
        _tag: "Fail",
        completedAt: "2026-08-23T07:56:00.000Z",
        dispatchId: extractionFingerprint,
        failureCode: "provider_error",
        recovery: "operator_review",
        stage: "extraction",
      },
    });
    expect(failed.status, await failed.clone().text()).toBe(200);

    const database = await getRuntime().getD1Database(
      "ProviderAccountingDatabase",
      "provider-recovery"
    );
    const budget = makeD1ProviderAccountingRepository(
      makeProviderAccountingDatabase(database)
    );
    const reservation = {
      dispatchId: Schema.decodeUnknownSync(ProviderAccountingDispatchId)(
        dispatchId
      ),
      maximumCostMicroUsd: 100_000,
      providerStageId: Schema.decodeUnknownSync(
        ProviderAccountingProviderStageId
      )("recipe-extraction"),
      runId: Schema.decodeUnknownSync(ProviderAccountingRunId)(
        `recipe-import:${admitted.id}`
      ),
      timestamp: Schema.decodeUnknownSync(ProviderAccountingTimestamp)(
        "2026-08-23T07:55:00.000Z"
      ),
    };
    await Effect.runPromise(budget.reserve(reservation));
    const providerClaim = await Effect.runPromise(
      budget.beginInvocation(reservation)
    );
    if (providerClaim._tag !== "Claimed") {
      throw new Error("expected provider invocation claim");
    }
    await Effect.runPromise(
      budget.settleUnknown({
        ...reservation,
        invocationGeneration: providerClaim.dispatch.invocationGeneration,
      })
    );

    const settlement = await terminalSettlementCommand({
      dispatchId,
      importId: admitted.id,
      operation: "settle_recipe_unknown",
    });
    expect(settlement.status, await settlement.clone().text()).toBe(200);
    await expect(settlement.json()).resolves.toMatchObject({
      conservativeChargeMicroUsd: 100_000,
      dispatchId,
      importId: admitted.id,
      outcome: "recipe_unknown_cost_accounted",
    });

    const preparationCommand = {
      acquisitionGeneration: generation,
      dispatchId,
      executionGeneration: generation,
      importId: admitted.id,
      operation: "prepare_recipe_recovery",
      organizationId: organization.id,
    } as const;
    const prepared = await terminalSettlementCommand(preparationCommand);
    expect(prepared.status, await prepared.clone().text()).toBe(200);
    const preparedBody = (await prepared.json()) as {
      readonly recoveryDispatchId: string;
      readonly recoveryExtractionFingerprint: string;
    };
    expect(preparedBody).toMatchObject({
      recoveryDispatchId: `${dispatchId}:recovery:1`,
    });

    const replay = await terminalSettlementCommand(preparationCommand);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(await replay.json()).toEqual(preparedBody);
    const attempt = await systemCommand("read-recipe-recovery-attempt", {
      admission,
      expectedGeneration: generation,
      intentId: admitted.id,
      selector: { _tag: "Latest", rootDispatchId: dispatchId },
    });
    expect(attempt.status, await attempt.clone().text()).toBe(200);
    await expect(attempt.json()).resolves.toMatchObject({
      currentDispatchId: `${dispatchId}:recovery:1`,
      currentExtractionFingerprint: preparedBody.recoveryExtractionFingerprint,
      ordinal: 1,
      rootDispatchId: dispatchId,
    });
    const removedSharedAuthority = await database
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE name IN (
              'import_recipe_executor_terminal_checkpoints',
              'import_recipe_executor_terminal_checkpoints_immutable_delete',
              'import_recipe_executor_terminal_checkpoints_immutable_update',
              'pilot_provider_terminal_checkpoints',
              'import_provider_terminal_checkpoints',
              'pilot_provider_recipe_recovery_attempts'
            )`
      )
      .all();
    expect(removedSharedAuthority.results).toEqual([]);
  });
});

const expectPrivateStatus = async (
  pending: Promise<{ readonly status: number }>,
  status: number
) => {
  const response = await pending;
  expect(response.status).toBe(status);
};
const privateControl = async (input: Record<string, unknown>) => {
  const worker = await getRuntime().getWorker("private-output-control");
  return worker.fetch("https://private-output.test/control", {
    headers: { "x-test-command": JSON.stringify(input) },
  });
};
const privateConnect = (
  cookie: string,
  sessionReference: string,
  additionalHeaders: Record<string, string> = {}
) =>
  getRuntime().dispatchFetch(
    `https://meal-planner.test/v1/private-interviews/${sessionReference}/connect`,
    {
      headers: {
        Origin: "https://meal-planner.test",
        Upgrade: "websocket",
        cookie,
        ...additionalHeaders,
      },
    }
  );
const openPrivateDirectory = async (cookie: string) => {
  const response = await privateConnect(cookie, "directory");
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("Expected a physical private directory WebSocket");
  }
  const frames: DirectoryFrame[] = [];
  const rawFrames: string[] = [];
  socket.addEventListener("message", (event) => {
    rawFrames.push(String(event.data));
    frames.push(
      Schema.decodeUnknownSync(DirectoryFrame)(JSON.parse(String(event.data)))
    );
  });
  socket.accept();
  const ready = await vi.waitFor(() => {
    const frame = frames.find(
      (candidate) => candidate.type === "DirectoryReady"
    );
    expect(frame).toBeDefined();
    if (frame?.type !== "DirectoryReady") {
      throw new Error("Expected directory readiness");
    }
    return frame;
  });
  const lifecycle = await privateControl({
    action: "directory-lifecycle",
    directoryKey: ready.bindingKey,
    sessionReference: crypto.randomUUID(),
  });
  const { result } = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        generation: Schema.String,
        status: Schema.Literal("connected"),
      }),
    })
  )(await lifecycle.json());
  return {
    bindingKey: ready.bindingKey,
    frames,
    generation: result.generation,
    rawFrames,
    socket,
  };
};
const reservePrivateSession = async (
  cookie: string,
  mutationId = crypto.randomUUID()
) => {
  const directory = await openPrivateDirectory(cookie);
  directory.socket.send(JSON.stringify({ mutationId, type: "StartSession" }));
  const started = await vi.waitFor(() => {
    const frame = directory.frames.find(
      (candidate) =>
        candidate.type === "SessionStarted" &&
        candidate.mutationId === mutationId
    );
    expect(frame).toBeDefined();
    if (frame?.type !== "SessionStarted") {
      throw new Error("Expected a directory reservation");
    }
    return frame;
  });
  directory.socket.close();
  return started.reservation.sessionReference;
};
const openPrivateConnection = async (
  cookie: string,
  existingReference?: string
) => {
  const sessionReference =
    existingReference ?? (await reservePrivateSession(cookie));
  const response = await privateConnect(cookie, sessionReference);
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("Expected a physical private interview WebSocket");
  }
  const messages: string[] = [];
  const frames: SessionFrame[] = [];
  socket.addEventListener("message", (event) => {
    const frame = Schema.decodeUnknownSync(SessionFrame)(
      JSON.parse(String(event.data))
    );
    frames.push(frame);
    if (frame.type === "HistoryRead") {
      messages.push(...frame.messages.map((message) => message.text));
    }
  });
  socket.accept();
  await vi.waitFor(() =>
    expect(frames.some((frame) => frame.type === "SessionReady")).toBe(true)
  );
  const lifecycle = await privateControl({
    action: "lifecycle",
    sessionReference,
  });
  const { result } = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ generation: Schema.String }) })
  )(await lifecycle.json());
  return {
    frames,
    generation: result.generation,
    messages,
    sessionReference,
    socket,
  };
};
const expectDirectoryFenced = async (
  directory: Awaited<ReturnType<typeof openPrivateDirectory>>
) => {
  const lifecycle = await privateControl({
    action: "directory-lifecycle",
    directoryKey: directory.bindingKey,
    sessionReference: crypto.randomUUID(),
  });
  expect(await lifecycle.json()).toMatchObject({
    result: { generation: directory.generation, status: "invalidated" },
  });
  const attempted = await privateControl({
    action: "directory-command-at-time",
    directoryKey: directory.bindingKey,
    generation: directory.generation,
    now: Date.now(),
    payload: JSON.stringify({
      afterOrdinal: 0,
      limit: 25,
      requestId: crypto.randomUUID(),
      type: "ListSessions",
    }),
    sessionReference: crypto.randomUUID(),
  });
  expect(attempted.status, await attempted.clone().text()).toBe(200);
  await delay(10);
  expect(directory.frames).toEqual([
    { bindingKey: directory.bindingKey, type: "DirectoryReady" },
  ]);
};
const expectDirectoryRevoked = async (
  directory: Awaited<ReturnType<typeof openPrivateDirectory>>,
  cookie: string
) => {
  await expectDirectoryFenced(directory);
  await expectPrivateStatus(privateConnect(cookie, "directory"), 403);
};
const emitPrivateOutput = async (
  connection: {
    readonly generation: string;
    readonly sessionReference: string;
  },
  payload: string
) => {
  const response = await privateControl({
    action: "emit",
    generation: connection.generation,
    payload,
    sessionReference: connection.sessionReference,
  });
  expect(response.status, await response.clone().text()).toBe(200);
};

describe("canonical private interview output boundary", () => {
  it.each([
    "/",
    "/agents/household/owner",
    "/sub/private-interview",
    "/mcp",
    "/rpc",
  ])(
    "does not expose a public parent, sub-agent or protocol route at %s",
    async (path) => {
      const worker = await getRuntime().getWorker("private-output-public");
      const response = await worker.fetch(
        `https://private-output.test${path}`,
        { headers: { Upgrade: "websocket" } }
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  );
  it("admits the linked adult and rejects other adults, households, missing cookies and copied references", async () => {
    const setup = await prepareLinkedAdult("Private Output Owner");
    const creationId = crypto.randomUUID();
    const reservation = await reservePrivateSession(
      setup.memberCookie,
      creationId
    );
    const connection = await openPrivateConnection(
      setup.memberCookie,
      reservation
    );
    await expectPrivateStatus(
      privateConnect(setup.memberCookie, crypto.randomUUID()),
      403
    );
    expect(await reservePrivateSession(setup.memberCookie, creationId)).toBe(
      reservation
    );
    const copiedCreation = await reservePrivateSession(
      setup.ownerCookie,
      creationId
    );
    expect(copiedCreation).not.toBe(reservation);
    await emitPrivateOutput(connection, "synthetic-private-authorized");
    await delay(10);
    expect(connection.messages).toEqual(["synthetic-private-authorized"]);
    const ownDirectory = await openPrivateDirectory(setup.memberCookie);
    ownDirectory.socket.send(
      JSON.stringify({
        afterOrdinal: 0,
        limit: 25,
        requestId: crypto.randomUUID(),
        type: "ListSessions",
      })
    );
    await vi.waitFor(() =>
      expect(ownDirectory.frames).toContainEqual(
        expect.objectContaining({
          reservations: [
            expect.objectContaining({ sessionReference: reservation }),
          ],
          type: "SessionsListed",
        })
      )
    );
    expect(ownDirectory.rawFrames.join("\n")).not.toContain(
      "synthetic-private-authorized"
    );
    const ownerDirectory = await openPrivateDirectory(setup.ownerCookie);
    ownerDirectory.socket.send(
      JSON.stringify({
        afterOrdinal: 0,
        limit: 25,
        requestId: crypto.randomUUID(),
        type: "ListSessions",
      })
    );
    await vi.waitFor(() =>
      expect(ownerDirectory.frames).toContainEqual(
        expect.objectContaining({
          reservations: [
            expect.objectContaining({ sessionReference: copiedCreation }),
          ],
          type: "SessionsListed",
        })
      )
    );
    expect(ownerDirectory.rawFrames.join("\n")).not.toContain(reservation);
    expect(ownerDirectory.rawFrames.join("\n")).not.toContain(
      "synthetic-private-authorized"
    );
    ownDirectory.socket.close();
    ownerDirectory.socket.close();
    await expectPrivateStatus(privateConnect("", "directory"), 403);
    await expectPrivateStatus(
      privateConnect(setup.memberCookie, "directory", {
        Origin: "https://foreign.test",
      }),
      403
    );
    await expectPrivateStatus(
      privateConnect(setup.ownerCookie, connection.sessionReference),
      403
    );
    await expectPrivateStatus(
      privateConnect("", connection.sessionReference),
      403
    );
    const other = await prepareLinkedAdult("Private Output Other Household");
    await expectPrivateStatus(
      privateConnect(other.memberCookie, connection.sessionReference),
      403
    );
    await expectPrivateStatus(
      privateConnect(setup.memberCookie, connection.sessionReference, {
        Origin: "https://foreign.test",
      }),
      403
    );
    await emitPrivateOutput(
      connection,
      "synthetic-owner-after-copied-reference"
    );
    await delay(10);
    expect(connection.messages).toEqual([
      "synthetic-private-authorized",
      "synthetic-owner-after-copied-reference",
    ]);
    connection.socket.close();
  }, 30_000);

  it("keeps participant transcript content out of shared household state, audit, coordinators and native logs", async () => {
    const capturedLogs: string[] = [];
    await restartRuntime(capturedLogs);
    try {
      const existingHouseholdIds = new Set(
        await getRuntime().listDurableObjectIds(
          "HouseholdObject",
          "household-domain"
        )
      );
      const setup = await prepareLinkedAdult("Private Transcript Isolation");
      const profileUrl = `https://meal-planner.test/v1/household/people/${setup.adult.id}/profile`;
      const seededProfile = await getRuntime().dispatchFetch(profileUrl, {
        body: JSON.stringify({
          command: {
            _tag: "AddProvisionalProfileFact",
            fact: {
              _tag: "FoodPreference",
              label: "Carrots",
              sentiment: "like",
              targetKind: "ingredient",
            },
          },
          expectedProfileVersion: 0,
          mutationId: "private-transcript-shared-profile",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      });
      expect(seededProfile.status).toBe(200);
      const connection = await openPrivateConnection(setup.memberCookie);
      const directory = await openPrivateDirectory(setup.memberCookie);
      const sharedViews = [
        "https://meal-planner.test/v1/household",
        "https://meal-planner.test/v1/household/people",
        profileUrl,
        `${profileUrl}/versions`,
        `${profileUrl}/audit`,
      ];
      const readSharedViews = () =>
        Promise.all(
          sharedViews.map(async (url) => {
            const response = await getRuntime().dispatchFetch(url, {
              headers: { cookie: setup.ownerCookie },
            });
            expect(response.status).toBe(200);
            return response.text();
          })
        );
      const before = await readSharedViews();
      const probe = await getRuntime().dispatchFetch(
        "https://meal-planner.test/v1/test-log-capture",
        { headers: { "x-test-native-log-probe": "1" } }
      );
      expect(probe.status).toBe(204);
      await vi.waitFor(() =>
        expect(
          capturedLogs.some((entry) =>
            entry.includes("Synthetic native log capture probe")
          )
        ).toBe(true)
      );
      const sentinel = `private-transcript-${crypto.randomUUID()}`;
      const mutationId = crypto.randomUUID();
      connection.socket.send(
        JSON.stringify({
          expectedVersion: 0,
          mutationId,
          text: sentinel,
          type: "AppendParticipantMessage",
        })
      );
      await vi.waitFor(() =>
        expect(
          connection.frames.some(
            (frame) =>
              frame.type === "MessageAppended" &&
              frame.mutationId === mutationId &&
              frame.message.text === sentinel
          )
        ).toBe(true)
      );
      const historyRequest = crypto.randomUUID();
      connection.socket.send(
        JSON.stringify({
          afterOrdinal: 0,
          limit: 25,
          requestId: historyRequest,
          type: "ReadHistory",
        })
      );
      await vi.waitFor(() =>
        expect(
          connection.frames.some(
            (frame) =>
              frame.type === "HistoryRead" &&
              frame.requestId === historyRequest &&
              frame.messages.some((message) => message.text === sentinel)
          )
        ).toBe(true)
      );
      const after = await readSharedViews();
      expect(JSON.stringify(after) === JSON.stringify(before)).toBe(true);
      expect(after.some((body) => body.includes(sentinel))).toBe(false);
      directory.socket.send(
        JSON.stringify({
          afterOrdinal: 0,
          limit: 25,
          requestId: crypto.randomUUID(),
          type: "ListSessions",
        })
      );
      await vi.waitFor(() =>
        expect(
          directory.frames.some((frame) => frame.type === "SessionsListed")
        ).toBe(true)
      );
      expect(
        directory.rawFrames.some((frame) => frame.includes(sentinel))
      ).toBe(false);
      const metadata = await privateControl({
        action: "metadata",
        sessionReference: connection.sessionReference,
      });
      const { result: binding } = Schema.decodeUnknownSync(
        Schema.Struct({ result: PrivateParticipantBinding })
      )(await metadata.json());
      const currentHouseholdIds = await getRuntime().listDurableObjectIds(
        "HouseholdObject",
        "household-domain"
      );
      const householdIds = currentHouseholdIds.filter(
        (id) => !existingHouseholdIds.has(id)
      );
      expect(householdIds).toHaveLength(1);
      const [householdId] = householdIds;
      if (householdId === undefined) {
        throw new Error("Expected the canonical household storage target");
      }
      const householdStorage = await getRuntime().unsafeGetDurableObjectStorage(
        "household-domain",
        "HouseholdObject",
        { id: householdId }
      );
      expect(
        await householdStorage.exec(
          "SELECT organization_id FROM household_meta"
        )
      ).toEqual([{ organization_id: setup.organization.id }]);
      const coordinators = await Promise.all([
        getRuntime().unsafeGetDurableObjectStorage(
          "private-output",
          "AccountOutputLifecycle",
          { name: binding.accountKey }
        ),
        getRuntime().unsafeGetDurableObjectStorage(
          "private-output",
          "HouseholdAgent",
          { name: binding.householdKey }
        ),
      ]);
      await Promise.all(
        coordinators.map(async (storage) => {
          const registrations = await storage.exec<{ target_kind: string }>(
            "SELECT DISTINCT target_kind FROM output_registrations ORDER BY target_kind"
          );
          expect(registrations).toEqual([
            { target_kind: "directory" },
            { target_kind: "session" },
          ]);
        })
      );
      await Promise.all(
        [householdStorage, ...coordinators].map(async (storage) => {
          const tables = await storage.exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
          );
          expect(tables.length).toBeGreaterThan(0);
          await Promise.all(
            tables.map(async ({ name }) => {
              const rows = await storage.exec(
                `SELECT * FROM "${name.replaceAll('"', '""')}"`
              );
              const textValues = rows.flatMap((row) =>
                Object.values(row).map((value) =>
                  value instanceof ArrayBuffer
                    ? new TextDecoder().decode(value)
                    : String(value)
                )
              );
              expect(
                textValues.some((value) => value.includes(sentinel)),
                `Transcript privacy for stored table ${name}`
              ).toBe(false);
            })
          );
        })
      );
      connection.socket.close();
      directory.socket.close();
      await delay(20);
      expect(capturedLogs.some((entry) => entry.includes(sentinel))).toBe(
        false
      );
    } finally {
      await restartRuntime();
    }
  }, 30_000);

  it("stops passive and in-flight output before real Better Auth sign-out commits", async () => {
    const setup = await prepareLinkedAdult("Private Passive Revoke");
    const connection = await openPrivateConnection(setup.memberCookie);
    const directory = await openPrivateDirectory(setup.memberCookie);
    const session = await getSession(setup.memberCookie);
    await emitPrivateOutput(connection, "synthetic-before-sign-out");
    const producer = Promise.withResolvers<null>();
    const delayed = producer.promise.then(() =>
      emitPrivateOutput(connection, "synthetic-inflight-after-sign-out")
    );
    const revoked = await authRequest("/sign-out", {}, setup.memberCookie);
    expect(revoked.status).toBe(200);
    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    expect(
      await database
        .select({ id: authSchema.session.id })
        .from(authSchema.session)
        .where(eq(authSchema.session.id, session.session.id))
    ).toEqual([]);
    producer.resolve(null);
    await delayed;
    await emitPrivateOutput(connection, "synthetic-passive-after-sign-out");
    await expectDirectoryRevoked(directory, setup.memberCookie);
    await delay(10);
    expect(connection.messages).toEqual(["synthetic-before-sign-out"]);
    await expectPrivateStatus(
      privateConnect(setup.memberCookie, connection.sessionReference),
      403
    );
  }, 30_000);

  it.each(["directory", "session"] as const)(
    "keeps real sign-out uncommitted after a lost %s invalidation acknowledgement and safely retries",
    async (kind) => {
      const setup = await prepareLinkedAdult(
        `Private Lost Acknowledgement ${kind}`
      );
      const connection = await openPrivateConnection(setup.memberCookie);
      const directory = await openPrivateDirectory(setup.memberCookie);
      const session = await getSession(setup.memberCookie);
      const database = drizzle(
        await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
      );
      const fault = await privateControl({
        action: kind === "directory" ? "directory-lose-ack" : "lose-ack",
        directoryKey: directory.bindingKey,
        sessionReference: connection.sessionReference,
      });
      expect(fault.status).toBe(200);
      const failed = await authRequest("/sign-out", {}, setup.memberCookie);
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(
        await database
          .select({ id: authSchema.session.id })
          .from(authSchema.session)
          .where(eq(authSchema.session.id, session.session.id))
      ).toEqual([{ id: session.session.id }]);
      await expectDirectoryFenced(directory);
      await expectPrivateStatus(
        privateConnect(setup.memberCookie, "directory"),
        403
      );
      await expectPrivateStatus(
        privateConnect(setup.memberCookie, connection.sessionReference),
        403
      );
      await emitPrivateOutput(
        connection,
        "synthetic-after-lost-acknowledgement"
      );
      expect(connection.messages).toEqual([]);
      const retried = await authRequest("/sign-out", {}, setup.memberCookie);
      expect(retried.status).toBe(200);
      expect(
        await database
          .select({ id: authSchema.session.id })
          .from(authSchema.session)
          .where(eq(authSchema.session.id, session.session.id))
      ).toEqual([]);
    },
    30_000
  );

  it("commits real sign-out while an unrelated refresh has an ambiguous retained dispatch", async () => {
    const setup = await prepareLinkedAdult("Private Retained Refresh");
    const connection = await openPrivateConnection(setup.memberCookie);
    const directory = await openPrivateDirectory(setup.memberCookie);
    const session = await getSession(setup.memberCookie);
    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    const [canonicalSession] = await database
      .select({ token: authSchema.session.token })
      .from(authSchema.session)
      .where(eq(authSchema.session.id, session.session.id));
    if (canonicalSession === undefined) {
      throw new Error("Expected the canonical synthetic session.");
    }
    const identity = {
      intentKey: await privateOutputKey(
        "auth-mutation",
        JSON.stringify({
          kind: "session-refresh",
          token: canonicalSession.token,
        })
      ),
      key: await privateOutputKey("account", session.user.id),
      scope: "account",
      sessionReference: connection.sessionReference,
    };
    const begun = await privateControl({
      ...identity,
      action: "mutation-begin",
    });
    expect(begun.status).toBe(200);
    const { result } = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ operationId: Schema.String }) })
    )(await begun.json());
    const operation = { ...identity, operationId: result.operationId };
    await expectPrivateStatus(
      privateControl({ ...operation, action: "mutation-prepare" }),
      200
    );
    await expectPrivateStatus(
      privateControl({ ...operation, action: "mutation-dispatch" }),
      200
    );
    await expectPrivateStatus(
      privateConnect(setup.memberCookie, connection.sessionReference),
      403
    );
    const revoked = await authRequest("/sign-out", {}, setup.memberCookie);
    expect(revoked.status).toBe(200);
    expect(
      await database
        .select({ id: authSchema.session.id })
        .from(authSchema.session)
        .where(eq(authSchema.session.id, session.session.id))
    ).toEqual([]);
    const retained = await privateControl({
      ...operation,
      action: "mutation-read",
    });
    expect(await retained.json()).toEqual({ result: { phase: "dispatched" } });
    await emitPrivateOutput(connection, "synthetic-after-distinct-revocation");
    await expectDirectoryRevoked(directory, setup.memberCookie);
    await delay(10);
    expect(connection.messages).toEqual([]);
  }, 30_000);

  it.each(["directory", "session"] as const)(
    "rejects %s activation whose final canonical household read finished before a concurrent real session revocation",
    async (kind) => {
      const setup = await prepareLinkedAdult(`Private Final Read Race ${kind}`);
      const sessionReference =
        kind === "directory"
          ? "directory"
          : await reservePrivateSession(setup.memberCookie);
      const barrier = crypto.randomUUID();
      const observations = await getRuntime().getKVNamespace(
        "HOUSEHOLD_TEST_OBSERVATIONS",
        "api"
      );
      const pending = privateConnect(setup.memberCookie, sessionReference, {
        "x-test-private-output-authority-barrier": barrier,
      });
      try {
        let reached = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (
            // eslint-disable-next-line no-await-in-loop -- Poll a durable barrier before releasing the deliberately stalled request.
            (await observations.get(`private-output-read:${barrier}`)) ===
            "ready"
          ) {
            reached = true;
            break;
          }
          // eslint-disable-next-line no-await-in-loop -- The barrier must be observed between polling intervals.
          await delay(20);
        }
        expect(reached).toBe(true);
        const revoked = await authRequest(
          "/revoke-sessions",
          {},
          setup.memberCookie
        );
        expect(revoked.status).toBe(200);
      } finally {
        await observations.put(`private-output-release:${barrier}`, "release");
      }
      await expectPrivateStatus(pending, 403);
    },
    30_000
  );

  it.each(["directory", "session"] as const)(
    "fails closed for %s when the final canonical authority service becomes unavailable",
    async (kind) => {
      const setup = await prepareLinkedAdult(
        `Private Authority Unavailable ${kind}`
      );
      const sessionReference =
        kind === "directory"
          ? "directory"
          : await reservePrivateSession(setup.memberCookie);
      await expectPrivateStatus(
        privateConnect(setup.memberCookie, sessionReference, {
          "x-test-private-output-authority-failure": "1",
        }),
        403
      );
      if (kind === "directory") {
        const fresh = await openPrivateDirectory(setup.memberCookie);
        fresh.socket.close();
        return;
      }
      const lifecycle = await privateControl({
        action: "lifecycle",
        sessionReference,
      });
      const retained = Schema.decodeUnknownSync(
        Schema.Struct({
          result: Schema.Struct({
            generation: Schema.String,
            status: Schema.String,
          }),
        })
      )(await lifecycle.json());
      expect(retained.result.status).toBe("pending");
      await emitPrivateOutput(
        { generation: retained.result.generation, sessionReference },
        "synthetic-after-authority-failure"
      );
      const fresh = await openPrivateConnection(
        setup.memberCookie,
        sessionReference
      );
      await emitPrivateOutput(
        fresh,
        "synthetic-after-canonical-reauthentication"
      );
      await delay(10);
      expect(fresh.messages).toEqual([
        "synthetic-after-canonical-reauthentication",
      ]);
      fresh.socket.close();
    },
    30_000
  );

  it("disables output for the captured household when the real active organization changes", async () => {
    const setup = await prepareLinkedAdult("Private Active Organization");
    const connection = await openPrivateConnection(setup.memberCookie);
    const directory = await openPrivateDirectory(setup.memberCookie);
    const changed = await createOrganization(
      "Private Alternate Organization",
      setup.memberCookie
    );
    expect(changed.id).not.toBe(setup.organization.id);
    await emitPrivateOutput(
      connection,
      "synthetic-after-active-organization-change"
    );
    await expectDirectoryRevoked(directory, setup.memberCookie);
    await delay(10);
    expect(connection.messages).toEqual([]);
    await expectPrivateStatus(
      privateConnect(setup.memberCookie, connection.sessionReference),
      403
    );
  }, 30_000);

  it("fences departure preparation before membership removal and cannot reauthorize the pending adult", async () => {
    const setup = await prepareLinkedAdult("Private Household Departure");
    const connection = await openPrivateConnection(setup.memberCookie);
    const directory = await openPrivateDirectory(setup.memberCookie);
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/departures",
      {
        body: JSON.stringify({
          expectedLinkVersion: 1,
          expectedPersonVersion: setup.adult.version,
          memberId: setup.memberId,
          mutationId: "private-output-departure",
          personId: setup.adult.id,
          reason: "Synthetic adult departure",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
          "x-test-member-departure-crash": "after-prepare-before-start",
        },
        method: "POST",
      }
    );
    expect(response.status).toBeGreaterThanOrEqual(500);
    const prepared = await readDepartureByMutationEventually(
      setup.ownerCookie,
      "private-output-departure",
      "prepared"
    );
    expect(prepared.state).toBe("prepared");
    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    expect(
      await database
        .select({ id: authSchema.member.id })
        .from(authSchema.member)
        .where(eq(authSchema.member.id, setup.memberId))
    ).toEqual([{ id: setup.memberId }]);
    await emitPrivateOutput(connection, "synthetic-after-household-departure");
    await expectDirectoryRevoked(directory, setup.memberCookie);
    await delay(10);
    expect(connection.messages).toEqual([]);
    await expectPrivateStatus(
      privateConnect(setup.memberCookie, connection.sessionReference),
      403
    );
  }, 30_000);

  it("revokes both private children when real departure removes membership and archives the adult", async () => {
    const setup = await prepareLinkedAdult("Private Completed Departure");
    const connection = await openPrivateConnection(setup.memberCookie);
    const directory = await openPrivateDirectory(setup.memberCookie);
    const mutationId = "private-output-completed-departure";
    const response = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/departures",
      {
        body: JSON.stringify({
          expectedLinkVersion: 1,
          expectedPersonVersion: setup.adult.version,
          memberId: setup.memberId,
          mutationId,
          personId: setup.adult.id,
          reason: "Synthetic adult departure",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(response.status, await response.clone().text()).toBe(202);
    await readDepartureByMutationEventually(
      setup.ownerCookie,
      mutationId,
      "completed"
    );
    const database = drizzle(
      await getRuntime().getD1Database("MealPlannerAuthDatabase", "api")
    );
    expect(
      await database
        .select({ id: authSchema.member.id })
        .from(authSchema.member)
        .where(eq(authSchema.member.id, setup.memberId))
    ).toEqual([]);
    const rosterResponse = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people?includeArchived=true",
      { headers: { cookie: setup.ownerCookie } }
    );
    const roster = await Schema.decodeUnknownPromise(HouseholdPeopleRoster)(
      await rosterResponse.json()
    );
    expect(
      roster.people.find((person) => person.id === setup.adult.id)
    ).toMatchObject({ associationState: "detached", lifecycle: "archived" });
    await expectDirectoryRevoked(directory, setup.memberCookie);
    await emitPrivateOutput(connection, "synthetic-after-membership-removal");
    expect(connection.messages).toEqual([]);
    await expectPrivateStatus(
      privateConnect(setup.memberCookie, connection.sessionReference),
      403
    );
  }, 30_000);

  it("keeps the original immutable person binding after a canonical adult-link repair", async () => {
    const setup = await prepareLinkedAdult("Private Immutable Repair");
    const connection = await openPrivateConnection(setup.memberCookie);
    const directory = await openPrivateDirectory(setup.memberCookie);
    const created = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      {
        body: JSON.stringify({
          displayName: "Synthetic replacement adult",
          kind: "adult",
          mutationId: "private-output-replacement",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    const replacement = await Schema.decodeUnknownPromise(HouseholdPerson)(
      await created.json()
    );
    const repaired = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people/links/repair",
      {
        body: JSON.stringify({
          expectedPersonVersion: replacement.version,
          memberId: setup.memberId,
          mutationId: "private-output-repair",
          personId: replacement.id,
          reason: "Synthetic explicit linkage repair",
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(repaired.status, await repaired.clone().text()).toBe(200);
    await emitPrivateOutput(connection, "synthetic-after-link-repair");
    await delay(10);
    expect(connection.messages).toEqual([]);
    await expectPrivateStatus(
      privateConnect(setup.memberCookie, connection.sessionReference),
      403
    );
    await expectDirectoryFenced(directory);
    const replacementDirectory = await openPrivateDirectory(setup.memberCookie);
    expect(replacementDirectory.bindingKey).not.toBe(directory.bindingKey);
    replacementDirectory.socket.send(
      JSON.stringify({
        afterOrdinal: 0,
        limit: 25,
        requestId: crypto.randomUUID(),
        type: "ListSessions",
      })
    );
    await vi.waitFor(() =>
      expect(replacementDirectory.frames).toContainEqual(
        expect.objectContaining({ reservations: [], type: "SessionsListed" })
      )
    );
    replacementDirectory.socket.close();
    const metadata = await privateControl({
      action: "metadata",
      sessionReference: connection.sessionReference,
    });
    expect(await metadata.json()).toMatchObject({
      result: {
        personId: setup.adult.id,
        sessionReference: connection.sessionReference,
      },
    });
    const fresh = await openPrivateConnection(setup.memberCookie);
    await emitPrivateOutput(fresh, "synthetic-new-explicit-session");
    await delay(10);
    expect(fresh.messages).toEqual(["synthetic-new-explicit-session"]);
    fresh.socket.close();
  }, 30_000);
});

type CardConnection = Awaited<ReturnType<typeof openPrivateConnection>>;
const cardExchange = (
  connection: CardConnection,
  command: Record<string, unknown> & { readonly type: string }
) => {
  const start = connection.frames.length;
  const id = command["mutationId"] ?? command["requestId"];
  connection.socket.send(JSON.stringify(command));
  return vi.waitFor(() => {
    const frame = connection.frames
      .slice(start)
      .find(
        (candidate) =>
          ("mutationId" in candidate && candidate.mutationId === id) ||
          ("requestId" in candidate && candidate.requestId === id) ||
          ("commandId" in candidate && candidate.commandId === id)
      );
    expect(frame).toBeDefined();
    if (frame === undefined) {
      throw new Error("Expected private card response");
    }
    return frame;
  });
};
const readPrivateCards = async (
  connection: CardConnection,
  afterOrdinal = 0,
  limit = 25
) => {
  const frame = await cardExchange(connection, {
    afterOrdinal,
    limit,
    requestId: crypto.randomUUID(),
    type: "ReadCards",
  });
  if (frame.type !== "CardsRead") {
    throw new Error("Expected private cards");
  }
  return frame;
};
const preferenceChange = (label = "Carrots") => ({
  _tag: "AddConfirmedProfileFact" as const,
  fact: {
    _tag: "FoodPreference" as const,
    label,
    sentiment: "like" as const,
    targetKind: "ingredient" as const,
  },
});
const seedPrivateCard = async (
  connection: CardConnection,
  change: ProfileCard["change"] = preferenceChange(),
  expectedProfileVersion = 0,
  reviewedFact: ProfileCard["reviewedFact"] = null
) => {
  const storage = await getRuntime().unsafeGetDurableObjectStorage(
    "private-output",
    "PrivateInterviewSession",
    { name: await privateOutputKey("session", connection.sessionReference) }
  );
  const [next] = await storage.exec<{ ordinal: number }>(
    "SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM private_profile_cards"
  );
  const card = Schema.decodeUnknownSync(ProfileCard)({
    change,
    expectedProfileVersion,
    id: crypto.randomUUID(),
    ordinal: next?.ordinal ?? 1,
    outcome: null,
    reviewedFact,
    revision: 0,
    status: "proposed",
  });
  await storage.exec(
    "INSERT INTO private_profile_cards (ordinal, id, card_json) VALUES (?, ?, ?)",
    card.ordinal,
    card.id,
    JSON.stringify(card)
  );
  const seededCards = await readPrivateCards(connection);
  expect(seededCards.cards).toContainEqual(card);
  return card;
};
const freezePrivateCard = (
  connection: CardConnection,
  card: ProfileCard,
  expectedVersion: number,
  mutationId = crypto.randomUUID(),
  safetyConfirmation: string | null = null
) =>
  cardExchange(connection, {
    cardId: card.id,
    cardRevision: card.revision,
    expectedVersion,
    mutationId,
    safetyConfirmation,
    type: "ConfirmProfileCard",
  });
const postPrivateConfirmation = (
  cookie: string,
  connection: Pick<CardConnection, "generation" | "sessionReference">,
  mutationId: string,
  headers: Record<string, string> = {},
  body?: string
) => {
  const request: Parameters<Miniflare["dispatchFetch"]>[1] = {
    headers: {
      Origin: "https://meal-planner.test",
      cookie,
      "x-private-output-generation": connection.generation,
      ...headers,
    },
    method: "POST",
  };
  if (body !== undefined) {
    request.body = body;
  }
  return getRuntime().dispatchFetch(
    `https://meal-planner.test/v1/private-interviews/${connection.sessionReference}/confirmations/${mutationId}`,
    request
  );
};
const profileAddress = (personId: string) =>
  `https://meal-planner.test/v1/household/people/${personId}/profile`;
const readCardProfile = async (
  setup: Awaited<ReturnType<typeof prepareLinkedAdult>>
) => {
  const response = await getRuntime().dispatchFetch(
    profileAddress(setup.adult.id),
    {
      headers: { cookie: setup.ownerCookie },
    }
  );
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(PersonProfile)(await response.json());
};
const manualCardProfile = (
  setup: Awaited<ReturnType<typeof prepareLinkedAdult>>,
  payload: object
) =>
  getRuntime().dispatchFetch(profileAddress(setup.adult.id), {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json", cookie: setup.memberCookie },
    method: "POST",
  });
const awaitCardBarrier = async (
  id: string,
  phase: "before" | "after" | "before-release"
) => {
  const observations = await getRuntime().getKVNamespace(
    "HOUSEHOLD_TEST_OBSERVATIONS",
    "api"
  );
  await vi.waitFor(async () =>
    expect(await observations.get(`private-confirmation-${phase}:${id}`)).toBe(
      "ready"
    )
  );
  return (outcome = "release") =>
    observations.put(`private-confirmation-release:${id}`, outcome);
};

const cardHouseholdStorage = async (organizationId: string) => {
  const ids = await getRuntime().listDurableObjectIds(
    "HouseholdObject",
    "household-domain"
  );
  const candidates = await Promise.all(
    ids.map(async (id) => {
      const storage = await getRuntime().unsafeGetDurableObjectStorage(
        "household-domain",
        "HouseholdObject",
        { id }
      );
      const rows = await storage.exec<{ organization_id: string }>(
        "SELECT organization_id FROM household_meta"
      );
      return rows.some((row) => row.organization_id === organizationId)
        ? storage
        : null;
    })
  );
  const storage = candidates.find((candidate) => candidate !== null);
  if (storage === undefined) {
    throw new Error("Expected canonical household storage");
  }
  return storage;
};
const repairCardParticipant = async (
  setup: Awaited<ReturnType<typeof prepareLinkedAdult>>,
  personId: string
) => {
  const personResponse = await getRuntime().dispatchFetch(
    `https://meal-planner.test/v1/household/people/${personId}`,
    { headers: { cookie: setup.ownerCookie } }
  );
  const person = Schema.decodeUnknownSync(HouseholdPerson)(
    await personResponse.json()
  );
  const response = await getRuntime().dispatchFetch(
    "https://meal-planner.test/v1/household/people/links/repair",
    {
      body: JSON.stringify({
        expectedPersonVersion: person.version,
        memberId: setup.memberId,
        mutationId: crypto.randomUUID(),
        personId,
        reason: "Synthetic canonical confirmation race",
      }),
      headers: {
        "content-type": "application/json",
        cookie: setup.ownerCookie,
      },
      method: "POST",
    }
  );
  expect(response.status, await response.clone().text()).toBe(200);
};

describe("canonical private profile cards", () => {
  const capturedCardLogs: string[] = [];
  beforeAll(async () => {
    await restartRuntime(capturedCardLogs);
  });
  it("keeps correction and rejection private, then confirms only the reviewed revision with interview provenance", async () => {
    const setup = await prepareLinkedAdult("Private Card Revision");
    const connection = await openPrivateConnection(setup.memberCookie);
    const card = await seedPrivateCard(connection);
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    const reviseId = crypto.randomUUID();
    const revised = await cardExchange(connection, {
      cardId: card.id,
      cardRevision: 0,
      change: preferenceChange("Broccoli"),
      expectedProfileVersion: 0,
      expectedVersion: 0,
      mutationId: reviseId,
      reviewedFact: null,
      type: "ReviseProfileCard",
    });
    expect(revised).toMatchObject({
      card: { revision: 1, status: "proposed" },
      state: { version: 1 },
      type: "CardUpdated",
    });
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    expect(await freezePrivateCard(connection, card, 1)).toMatchObject({
      reason: "card_conflict",
      type: "Rejected",
    });
    const rejected = await cardExchange(connection, {
      cardId: card.id,
      cardRevision: 1,
      expectedVersion: 1,
      mutationId: crypto.randomUUID(),
      type: "RejectProfileCard",
    });
    expect(rejected).toMatchObject({
      card: { status: "rejected" },
      type: "CardUpdated",
    });
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    const chosen = await seedPrivateCard(
      connection,
      preferenceChange("Potatoes")
    );
    const beforeTranscript = await readPrivateCards(connection);
    const transcriptSentinel = `private-card-transcript-${crypto.randomUUID()}`;
    expect(
      await cardExchange(connection, {
        expectedVersion: beforeTranscript.state.version,
        mutationId: crypto.randomUUID(),
        text: transcriptSentinel,
        type: "AppendParticipantMessage",
      })
    ).toMatchObject({
      message: { text: transcriptSentinel },
      type: "MessageAppended",
    });
    const probe = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/test-log-capture",
      {
        headers: { "x-test-native-log-probe": "1" },
      }
    );
    expect(probe.status).toBe(204);
    await vi.waitFor(() =>
      expect(
        capturedCardLogs.some((entry) =>
          entry.includes("Synthetic native log capture probe")
        )
      ).toBe(true)
    );
    const current = await readPrivateCards(connection);
    const confirmationId = crypto.randomUUID();
    expect(
      await freezePrivateCard(
        connection,
        chosen,
        current.state.version,
        confirmationId
      )
    ).toMatchObject({ type: "ConfirmationPending" });
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    const confirmed = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      confirmationId
    );
    expect(confirmed.status, await confirmed.clone().text()).toBe(204);
    const profile = await readCardProfile(setup);
    expect(profile).toMatchObject({
      audit: {
        actorPersonId: setup.adult.id,
        nextVersion: 1,
        previousVersion: 0,
        source: "interview",
      },
      facts: [
        {
          source: "interview",
          standing: { _tag: "confirmed", basis: "self" },
          value: preferenceChange("Potatoes").fact,
        },
      ],
      version: 1,
    });
    const shared = JSON.stringify(profile);
    expect(shared.includes(connection.sessionReference)).toBe(false);
    expect(shared.includes(chosen.id)).toBe(false);
    expect(shared.includes("Broccoli")).toBe(false);
    expect(await readPrivateCards(connection)).toMatchObject({
      cards: [
        { status: "rejected" },
        {
          outcome: { profileVersion: 1, type: "committed" },
          status: "confirmed",
        },
      ],
      pendingConfirmation: null,
    });
    const sharedStorage = await cardHouseholdStorage(setup.organization.id);
    const metadata = await privateControl({
      action: "metadata",
      sessionReference: connection.sessionReference,
    });
    const { result: binding } = Schema.decodeUnknownSync(
      Schema.Struct({ result: PrivateParticipantBinding })
    )(await metadata.json());
    const coordinators = await Promise.all([
      getRuntime().unsafeGetDurableObjectStorage(
        "private-output",
        "AccountOutputLifecycle",
        { name: binding.accountKey }
      ),
      getRuntime().unsafeGetDurableObjectStorage(
        "private-output",
        "HouseholdAgent",
        { name: binding.householdKey }
      ),
    ]);
    const privateValues = [
      connection.sessionReference,
      chosen.id,
      card.id,
      transcriptSentinel,
      "Broccoli",
    ];
    await Promise.all(
      [sharedStorage, ...coordinators].map(async (storage) => {
        const tables = await storage.exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table'"
        );
        await Promise.all(
          tables.map(async ({ name }) => {
            const rows = await storage.exec(
              `SELECT * FROM "${name.replaceAll('"', '""')}"`
            );
            const stored = rows
              .flatMap((row) =>
                Object.values(row).map((value) =>
                  value instanceof ArrayBuffer
                    ? new TextDecoder().decode(value)
                    : String(value)
                )
              )
              .join("\n");
            expect(
              privateValues.some((value) => stored.includes(value)),
              `Private card data absent from shared table ${name}`
            ).toBe(false);
          })
        );
      })
    );
    expect(
      privateValues.some((value) =>
        capturedCardLogs.some((entry) => entry.includes(value))
      )
    ).toBe(false);
    const replay = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      confirmationId
    );
    expect(replay.status).toBe(204);
    expect(await readCardProfile(setup)).toEqual(profile);
    const sourceCollision = await manualCardProfile(setup, {
      command: { ...preferenceChange("Potatoes"), basis: "self" },
      expectedProfileVersion: 0,
      mutationId: confirmationId,
    });
    expect(sourceCollision.status).toBe(409);
    expect(await sourceCollision.json()).toMatchObject({
      code: "mutation_collision",
    });
    const replayAfterCollision = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      confirmationId
    );
    expect(replayAfterCollision.status).toBe(204);
    expect(await readCardProfile(setup)).toEqual(profile);
    const readOnly = await readPrivateCards(connection);
    expect(
      await cardExchange(connection, {
        cardId: chosen.id,
        cardRevision: chosen.revision,
        expectedVersion: readOnly.state.version,
        mutationId: crypto.randomUUID(),
        type: "RejectProfileCard",
      })
    ).toMatchObject({ reason: "card_conflict", type: "Rejected" });
    expect(
      await cardExchange(connection, {
        cardId: card.id,
        cardRevision: 1,
        change: preferenceChange("Parsnips"),
        expectedProfileVersion: 1,
        expectedVersion: readOnly.state.version,
        mutationId: crypto.randomUUID(),
        reviewedFact: null,
        type: "ReviseProfileCard",
      })
    ).toMatchObject({ reason: "card_conflict", type: "Rejected" });
    expect(await readPrivateCards(connection)).toMatchObject({
      cards: readOnly.cards,
      pendingConfirmation: null,
      state: readOnly.state,
    });
    connection.socket.close();
  });

  it("pages maximum-label proposals within the private frame budget and retains completed cards as read-only history", async () => {
    const setup = await prepareLinkedAdult("Private Card Bounded Pages");
    const connection = await openPrivateConnection(setup.memberCookie);
    const storage = await getRuntime().unsafeGetDurableObjectStorage(
      "private-output",
      "PrivateInterviewSession",
      {
        name: await privateOutputKey("session", connection.sessionReference),
      }
    );
    const cards = Array.from({ length: 26 }, (_, index) =>
      Schema.decodeUnknownSync(ProfileCard)({
        change: preferenceChange(String(index).padStart(120, "a")),
        expectedProfileVersion: 0,
        id: crypto.randomUUID(),
        ordinal: index + 1,
        outcome: null,
        reviewedFact: preferenceChange("r".repeat(120)).fact,
        revision: 0,
        status: "proposed",
      })
    );
    await Promise.all(
      cards.map((card) =>
        storage.exec(
          "INSERT INTO private_profile_cards (ordinal, id, card_json) VALUES (?, ?, ?)",
          card.ordinal,
          card.id,
          JSON.stringify(card)
        )
      )
    );
    const page = await readPrivateCards(connection);
    expect(page.cards).toEqual(cards.slice(0, 25));
    expect(page.hasMore).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength
    ).toBeLessThanOrEqual(MAX_PRIVATE_FRAME_BYTES);
    const last = await readPrivateCards(connection, 25, 1);
    expect(last.cards).toEqual(cards.slice(25));
    expect(last.hasMore).toBe(false);
    expect(
      await cardExchange(connection, {
        expectedVersion: 0,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      })
    ).toMatchObject({ type: "SessionCompleted" });
    const completed = await readPrivateCards(connection);
    expect(completed).toMatchObject({ state: { status: "completed" } });
    const [first] = cards;
    if (first === undefined) {
      throw new Error("Expected seeded proposal");
    }
    expect(
      await freezePrivateCard(connection, first, completed.state.version)
    ).toMatchObject({ reason: "session_completed", type: "Rejected" });
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    const reread = await readPrivateCards(connection);
    expect(reread.cards).toEqual(completed.cards);
    connection.socket.close();
  });

  it("requires a separate explicit hard-constraint reduction and retains confirmed safety history", async () => {
    const setup = await prepareLinkedAdult("Private Card Safety");
    const connection = await openPrivateConnection(setup.memberCookie);
    const hardFact = {
      _tag: "HardConstraint",
      category: "allergen",
      handling: "exclude",
      label: "Peanuts",
    } as const;
    const card = await seedPrivateCard(connection, {
      _tag: "AddConfirmedProfileFact",
      fact: hardFact,
    });
    const confirmationId = crypto.randomUUID();
    expect(
      await freezePrivateCard(connection, card, 0, confirmationId)
    ).toMatchObject({ type: "ConfirmationPending" });
    const hardConfirmationResponse = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      confirmationId
    );
    expect(hardConfirmationResponse.status).toBe(204);
    const initial = await readCardProfile(setup);
    const [fact] = initial.facts;
    if (fact === undefined) {
      throw new Error("Expected confirmed constraint");
    }
    const bypass = await seedPrivateCard(
      connection,
      { _tag: "RemoveOrdinaryProfileFact", factId: fact.id },
      1,
      hardFact
    );
    const bypassId = crypto.randomUUID();
    const before = await readPrivateCards(connection);
    const frozen = await freezePrivateCard(
      connection,
      bypass,
      before.state.version,
      bypassId
    );
    expect(frozen).toMatchObject({ type: "ConfirmationPending" });
    const deniedBySafetyPolicy = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      bypassId
    );
    expect(deniedBySafetyPolicy.status).toBe(204);
    expect(await readPrivateCards(connection)).toMatchObject({
      cards: [
        { status: "confirmed" },
        {
          outcome: { reason: "safety_confirmation_required", type: "rejected" },
          status: "conflict",
        },
      ],
    });
    expect(await readCardProfile(setup)).toEqual(initial);
    const reduction = await seedPrivateCard(
      connection,
      {
        _tag: "ConfirmHardConstraintReduction",
        factId: fact.id,
        replacement: null,
      },
      1,
      hardFact
    );
    const state = await readPrivateCards(connection);
    expect(
      await freezePrivateCard(connection, reduction, state.state.version)
    ).toMatchObject({
      reason: "safety_confirmation_required",
      type: "Rejected",
    });
    const reduceId = crypto.randomUUID();
    expect(
      await freezePrivateCard(
        connection,
        reduction,
        state.state.version,
        reduceId,
        "I confirm this safety constraint change"
      )
    ).toMatchObject({ type: "ConfirmationPending" });
    const reductionResponse = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      reduceId
    );
    expect(reductionResponse.status).toBe(204);
    expect(await readCardProfile(setup)).toMatchObject({
      audit: {
        command: { _tag: "ConfirmHardConstraintReduction" },
        source: "interview",
      },
      facts: [],
      version: 2,
    });
    const historical = await getRuntime().dispatchFetch(
      `${profileAddress(setup.adult.id)}/versions/1`,
      { headers: { cookie: setup.memberCookie } }
    );
    expect(await historical.json()).toEqual(
      Schema.encodeSync(PersonProfile)(initial)
    );
    connection.socket.close();
  });

  it("retains stale-version and source-collision outcomes without silently rebasing", async () => {
    const setup = await prepareLinkedAdult("Private Card Conflict");
    const connection = await openPrivateConnection(setup.memberCookie);
    const card = await seedPrivateCard(connection);
    const manualId = crypto.randomUUID();
    const manual = await manualCardProfile(setup, {
      command: { ...preferenceChange("Beans"), basis: "self" },
      expectedProfileVersion: 0,
      mutationId: manualId,
    });
    expect(manual.status).toBe(200);
    const shared = await readCardProfile(setup);
    const confirmationId = crypto.randomUUID();
    expect(
      await freezePrivateCard(connection, card, 0, confirmationId)
    ).toMatchObject({ type: "ConfirmationPending" });
    const staleConfirmationResponse = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      confirmationId
    );
    expect(staleConfirmationResponse.status).toBe(204);
    expect(await readPrivateCards(connection)).toMatchObject({
      cards: [
        {
          expectedProfileVersion: 0,
          outcome: { reason: "stale_version", type: "rejected" },
          status: "conflict",
        },
      ],
    });
    expect(await readCardProfile(setup)).toEqual(shared);
    const collision = await seedPrivateCard(
      connection,
      preferenceChange("Beans"),
      0
    );
    const current = await readPrivateCards(connection);
    expect(
      await freezePrivateCard(
        connection,
        collision,
        current.state.version,
        manualId
      )
    ).toMatchObject({ type: "ConfirmationPending" });
    const collisionResponse = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      manualId
    );
    expect(collisionResponse.status).toBe(204);
    const conflictedCards = await readPrivateCards(connection);
    expect(conflictedCards.cards.at(-1)).toMatchObject({
      outcome: { reason: "mutation_collision", type: "rejected" },
    });
    expect(await readCardProfile(setup)).toEqual(shared);
    const exactManualReplay = await manualCardProfile(setup, {
      command: { ...preferenceChange("Beans"), basis: "self" },
      expectedProfileVersion: 0,
      mutationId: manualId,
    });
    expect(
      exactManualReplay.status,
      await exactManualReplay.clone().text()
    ).toBe(200);
    expect(await exactManualReplay.json()).toEqual(
      Schema.encodeSync(PersonProfile)(shared)
    );
    expect(await readCardProfile(setup)).toEqual(shared);
    connection.socket.close();
  });

  it("blocks another device completing while the canonical commit is in flight, then recovers the exact lost result after restart", async () => {
    const setup = await prepareLinkedAdult("Private Card Lost Result");
    const first = await openPrivateConnection(setup.memberCookie);
    const card = await seedPrivateCard(first);
    const mutationId = crypto.randomUUID();
    const frozen = await freezePrivateCard(first, card, 0, mutationId);
    expect(frozen).toMatchObject({ type: "ConfirmationPending" });
    const barrier = crypto.randomUUID();
    const pending = postPrivateConfirmation(
      setup.memberCookie,
      first,
      mutationId,
      { "x-test-private-confirmation-after": barrier }
    );
    const release = await awaitCardBarrier(barrier, "after");
    const committed = await readCardProfile(setup);
    expect(committed.version).toBe(1);
    const second = await openPrivateConnection(
      setup.memberCookie,
      first.sessionReference
    );
    const state = await readPrivateCards(second);
    expect(state.pendingConfirmation).toBe(mutationId);
    expect(
      await cardExchange(second, {
        expectedVersion: state.state.version,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      })
    ).toMatchObject({ reason: "confirmation_pending", type: "Rejected" });
    expect(
      await cardExchange(second, {
        cardId: card.id,
        cardRevision: card.revision,
        expectedVersion: state.state.version,
        mutationId: crypto.randomUUID(),
        type: "RejectProfileCard",
      })
    ).toMatchObject({ reason: "confirmation_pending", type: "Rejected" });
    await release("drop");
    const droppedResponse = await pending;
    expect(droppedResponse.status).toBe(503);
    const retainedCards = await readPrivateCards(second);
    expect(retainedCards.pendingConfirmation).toBe(mutationId);
    first.socket.close();
    second.socket.close();
    await restartRuntime();
    const restored = await openPrivateConnection(
      setup.memberCookie,
      first.sessionReference
    );
    const restoredCards = await readPrivateCards(restored);
    expect(restoredCards.pendingConfirmation).toBe(mutationId);
    const recoveryResponse = await postPrivateConfirmation(
      setup.memberCookie,
      restored,
      mutationId
    );
    expect(recoveryResponse.status).toBe(204);
    expect(await readCardProfile(setup)).toEqual(committed);
    const settled = await readPrivateCards(restored);
    expect(settled).toMatchObject({
      cards: [
        {
          outcome: { profileVersion: 1, type: "committed" },
          status: "confirmed",
        },
      ],
      pendingConfirmation: null,
    });
    expect(
      await cardExchange(restored, {
        expectedVersion: settled.state.version,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      })
    ).toMatchObject({ type: "SessionCompleted" });
    restored.socket.close();
  });

  it("denies copied references, unadmitted or body-substituted confirmation commands", async () => {
    const setup = await prepareLinkedAdult("Private Card Admission");
    const connection = await openPrivateConnection(setup.memberCookie);
    const card = await seedPrivateCard(connection);
    const mutationId = crypto.randomUUID();
    const prematureResponse = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId
    );
    expect(prematureResponse.status).toBe(503);
    expect(
      await freezePrivateCard(connection, card, 0, mutationId)
    ).toMatchObject({ type: "ConfirmationPending" });
    await Promise.all(
      ["", setup.ownerCookie].map(async (cookie) => {
        const deniedResponse = await postPrivateConfirmation(
          cookie,
          connection,
          mutationId
        );
        expect(deniedResponse.status).toBe(503);
      })
    );
    const crossOriginResponse = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId,
      { Origin: "https://foreign.test" }
    );
    expect(crossOriginResponse.status).toBe(403);
    const substitutedBodyResponse = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId,
      { "content-type": "application/json" },
      JSON.stringify({
        command: preferenceChange("Turnips"),
        personId: setup.adult.id,
      })
    );
    expect(substitutedBodyResponse.status).toBe(403);
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    const confirmedResponse = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId
    );
    expect(confirmedResponse.status).toBe(204);
    connection.socket.close();
  });

  it("rejects non-interview commands at the native Household boundary without settling the retained confirmation", async () => {
    const setup = await prepareLinkedAdult("Private Card Closed Commands");
    const connection = await openPrivateConnection(setup.memberCookie);
    const card = await seedPrivateCard(connection);
    const mutationId = crypto.randomUUID();
    expect(
      await freezePrivateCard(connection, card, 0, mutationId)
    ).toMatchObject({ type: "ConfirmationPending" });
    const attempts = await Promise.all(
      [
        { _tag: "AddProvisionalProfileFact", fact: preferenceChange().fact },
        { ...preferenceChange(), basis: "household_adult" },
      ].map((command) =>
        postPrivateConfirmation(setup.memberCookie, connection, mutationId, {
          "x-test-private-confirmation-command": JSON.stringify(command),
        })
      )
    );
    expect(attempts.map((response) => response.status)).toEqual([503, 503]);
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    expect(await readPrivateCards(connection)).toMatchObject({
      cards: [{ status: "pending" }],
      pendingConfirmation: mutationId,
    });
    const confirmed = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId
    );
    expect(confirmed.status).toBe(204);
    expect(await confirmed.text()).toBe("");
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [{ source: "interview", standing: { basis: "self" } }],
      version: 1,
    });
    connection.socket.close();
  });

  it("cannot borrow a new generation after an old confirmation request pauses with stale canonical auth", async () => {
    const label = "Private Card Stale Admission";
    const setup = await prepareLinkedAdult(label);
    const connection = await openPrivateConnection(setup.memberCookie);
    const card = await seedPrivateCard(connection);
    const mutationId = crypto.randomUUID();
    expect(
      await freezePrivateCard(connection, card, 0, mutationId)
    ).toMatchObject({ type: "ConfirmationPending" });
    const barrier = crypto.randomUUID();
    const staleRequest = postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId,
      {
        "x-test-private-confirmation-before-release": barrier,
        "x-test-private-confirmation-observation": barrier,
      }
    );
    const release = await awaitCardBarrier(barrier, "before-release");
    const signedOut = await authRequest("/sign-out", {}, setup.memberCookie);
    expect(signedOut.status).toBe(200);
    const freshCookie = await signIn(`${label} Adult`);
    const active = await authRequest(
      "/organization/set-active",
      { organizationId: setup.organization.id },
      freshCookie
    );
    expect(active.status).toBe(200);
    const restored = await openPrivateConnection(
      freshCookie,
      connection.sessionReference
    );
    expect(restored.generation).not.toBe(connection.generation);
    await release();
    const denied = await staleRequest;
    expect(denied.status).toBe(503);
    const observations = await getRuntime().getKVNamespace(
      "HOUSEHOLD_TEST_OBSERVATIONS",
      "api"
    );
    expect(
      await observations.get(`private-confirmation-household-calls:${barrier}`)
    ).toBeNull();
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    expect(await readPrivateCards(restored)).toMatchObject({
      cards: [{ status: "pending" }],
      pendingConfirmation: mutationId,
    });
    const confirmed = await postPrivateConfirmation(
      freshCookie,
      restored,
      mutationId,
      { "x-test-private-confirmation-observation": barrier }
    );
    expect(confirmed.status).toBe(204);
    expect(
      await observations.get(`private-confirmation-household-calls:${barrier}`)
    ).toBe("1");
    expect(await readCardProfile(setup)).toMatchObject({ version: 1 });
    connection.socket.close();
    restored.socket.close();
  });

  it("records a canonical policy rejection so an older overlapping attempt cannot commit after participant authority is restored", async () => {
    const setup = await prepareLinkedAdult("Private Card Terminal Rejection");
    const connection = await openPrivateConnection(setup.memberCookie);
    const card = await seedPrivateCard(connection);
    const mutationId = crypto.randomUUID();
    expect(
      await freezePrivateCard(connection, card, 0, mutationId)
    ).toMatchObject({ type: "ConfirmationPending" });
    const earlierBefore = crypto.randomUUID();
    const earlierAfter = crypto.randomUUID();
    const retryBefore = crypto.randomUUID();
    const retryAfter = crypto.randomUUID();
    const earlier = postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId,
      {
        "x-test-private-confirmation-after": earlierAfter,
        "x-test-private-confirmation-before": earlierBefore,
      }
    );
    const releaseEarlier = await awaitCardBarrier(earlierBefore, "before");
    const retry = postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId,
      {
        "x-test-private-confirmation-after": retryAfter,
        "x-test-private-confirmation-before": retryBefore,
      }
    );
    const releaseRetry = await awaitCardBarrier(retryBefore, "before");
    const created = await getRuntime().dispatchFetch(
      "https://meal-planner.test/v1/household/people",
      {
        body: JSON.stringify({
          displayName: "Synthetic temporary linked adult",
          kind: "adult",
          mutationId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          cookie: setup.ownerCookie,
        },
        method: "POST",
      }
    );
    expect(created.status).toBe(201);
    const replacement = Schema.decodeUnknownSync(HouseholdPerson)(
      await created.json()
    );
    await repairCardParticipant(setup, replacement.id);
    await releaseRetry();
    const releaseRejectedResult = await awaitCardBarrier(retryAfter, "after");
    const storage = await cardHouseholdStorage(setup.organization.id);
    const receipt = await storage.exec<{ outcome_json: string }>(
      "SELECT outcome_json FROM household_interview_profile_receipts WHERE mutation_id = ?",
      mutationId
    );
    expect(receipt).toHaveLength(1);
    expect(JSON.parse(receipt[0]?.outcome_json ?? "null")).toMatchObject({
      reason: "self_required",
      type: "rejected",
    });
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    await releaseRejectedResult("drop");
    const rejectedResponse = await retry;
    expect(rejectedResponse.status).toBe(503);
    await repairCardParticipant(setup, setup.adult.id);
    await releaseEarlier();
    const releaseEarlierResult = await awaitCardBarrier(earlierAfter, "after");
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    expect(
      await storage.exec(
        "SELECT outcome_json FROM household_interview_profile_receipts WHERE mutation_id = ?",
        mutationId
      )
    ).toEqual(receipt);
    await releaseEarlierResult("drop");
    const earlierResponse = await earlier;
    expect(earlierResponse.status).toBe(503);
    const restored = await openPrivateConnection(
      setup.memberCookie,
      connection.sessionReference
    );
    const restoredCards = await readPrivateCards(restored);
    expect(restoredCards.pendingConfirmation).toBe(mutationId);
    const restoredConfirmationResponse = await postPrivateConfirmation(
      setup.memberCookie,
      restored,
      mutationId
    );
    expect(restoredConfirmationResponse.status).toBe(204);
    const settledCards = await readPrivateCards(restored);
    expect(settledCards.cards).toMatchObject([
      {
        outcome: { reason: "self_required", type: "rejected" },
        status: "conflict",
      },
    ]);
    expect(await readCardProfile(setup)).toMatchObject({
      facts: [],
      version: 0,
    });
    connection.socket.close();
    restored.socket.close();
  });

  it("suppresses the old generation's terminal frame after canonical commit and sign-out while preserving exact recovery", async () => {
    const setup = await prepareLinkedAdult("Private Card Revocation");
    const connection = await openPrivateConnection(setup.memberCookie);
    const card = await seedPrivateCard(connection);
    const mutationId = crypto.randomUUID();
    expect(
      await freezePrivateCard(connection, card, 0, mutationId)
    ).toMatchObject({ type: "ConfirmationPending" });
    const barrier = crypto.randomUUID();
    const pending = postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId,
      { "x-test-private-confirmation-after": barrier }
    );
    const release = await awaitCardBarrier(barrier, "after");
    const committedProfile = await readCardProfile(setup);
    expect(committedProfile.version).toBe(1);
    const signedOut = await authRequest("/sign-out", {}, setup.memberCookie);
    expect(signedOut.status).toBe(200);
    await release();
    await pending;
    await delay(20);
    expect(
      connection.frames.some((frame) => frame.type === "ConfirmationSettled")
    ).toBe(false);
    const signedOutResponse = await postPrivateConfirmation(
      setup.memberCookie,
      connection,
      mutationId
    );
    expect(signedOutResponse.status).toBe(503);
    const retainedProfile = await readCardProfile(setup);
    expect(retainedProfile.version).toBe(1);
    connection.socket.close();
  });
});
