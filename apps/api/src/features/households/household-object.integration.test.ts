import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { HouseholdPerson } from "@meal-planner/household-api";
import {
  emptyRecipeDetails,
  makeRecipeContent,
  RecipeContent,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import { Effect, Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { workerObservability } from "../../infrastructure/worker-observability.js";
import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";
import {
  privateOutputRuntimeWorker,
  privateOutputTestBindings,
} from "../private-output/private-output-runtime.test-fixture.js";
import { HouseholdImportWorkflowDispatchView } from "./foundation/import-workflow-admission.contract.js";
import { HouseholdObjectLocator } from "./household-object-locator.js";
import {
  HouseholdDomainFailure,
  HouseholdMetadata,
  HouseholdOrganizationId,
} from "./household.contract.js";
import {
  HouseholdAdmitRecipeImportResult,
  HouseholdRecipePage,
} from "./recipe-import/household-recipe-import.contract.js";
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

const { date: compatibilityDate, flags: compatibilityFlags } =
  workerObservability.compatibility;
const recipeImportReview = (
  name: string,
  ingredientLines: readonly string[] = ["1 local ingredient"]
) => ({
  answers: [],
  blockers: { invalidFields: [], unresolvedRequiredFields: [] },
  editableFields: ["name", "ingredients", "instructions", "tags"],
  recipe: Schema.decodeUnknownSync(RecipeContent)({
    ...emptyRecipeDetails,
    ingredients: ingredientLines.map(recipeIngredientFromText),
    instructions: [recipeInstructionFromText("Cook locally.", 1)],
    name,
  }),
  tags: {
    cuisines: ["Irish"],
    difficulty: "easy",
    leftovers: "one_meal",
    mealTypes: ["dinner"],
    totalTimeBand: "under_30_minutes",
  },
});

/* eslint-disable no-use-before-define -- The cumulative tracer is grouped with its person fixture; runtime helpers are initialized before tests execute. */
describe("household person registry on real Durable Object SQLite", () => {
  it("renames a person once and rejects stale or changed retries", async () => {
    const scope = {
      actorId: "a".repeat(64),
      linkageSubject: "b".repeat(64),
      objectName: "rename-onboarding-person",
      organizationId: "rename-family",
    };
    const created = await dispatchHouseholdCommand({
      ...scope,
      displayName: "Original name",
      kind: "dependant",
      mutationId: "create-for-rename",
      operation: "createHouseholdPerson",
    });
    expect(created.ok).toBe(true);
    const person = Schema.decodeUnknownSync(HouseholdPerson)(created.value);
    const command = {
      ...scope,
      displayName: "New name",
      expectedVersion: person.version,
      mutationId: "rename-person-once",
      operation: "renameHouseholdPerson",
      personId: person.id,
    };
    const result = await dispatchHouseholdCommand(command);
    expect(result).toMatchObject({
      ok: true,
      value: { displayName: "New name", version: 2 },
    });
    expect(await dispatchHouseholdCommand(command)).toEqual(result);
    expect(
      await dispatchHouseholdCommand({
        ...command,
        displayName: "Different intent",
      })
    ).toMatchObject({
      error: { _tag: "HouseholdPersonMutationCollision" },
      ok: false,
    });
    expect(
      await dispatchHouseholdCommand({
        ...command,
        mutationId: "stale-rename-command",
      })
    ).toMatchObject({
      error: { _tag: "HouseholdPersonStaleVersion" },
      ok: false,
    });
  });

  it("requires accepted-recipient proof before linking an existing adult", async () => {
    const organizationId = "org-person-invitation-link";
    const objectName = await objectNameFor(organizationId);
    const ownerActorId = "1".repeat(64);
    const ownerLinkageSubject = "2".repeat(64);
    const memberActorId = "3".repeat(64);
    const memberLinkageSubject = "4".repeat(64);
    const invitationDigest = "5".repeat(64);

    await dispatchHouseholdCommand({
      actorId: ownerActorId,
      displayName: "Household owner",
      linkageSubject: ownerLinkageSubject,
      mutationId: "link-bootstrap-owner",
      objectName,
      operation: "bootstrapCreatorPerson",
      organizationId,
    });
    const adult = await dispatchHouseholdCommand({
      actorId: ownerActorId,
      displayName: "Invited adult",
      kind: "adult",
      linkageSubject: ownerLinkageSubject,
      mutationId: "link-create-adult",
      objectName,
      operation: "createHouseholdPerson",
      organizationId,
    });
    expect(adult.ok).toBe(true);
    const personId = (adult.value as { readonly id: string }).id;

    const associated = await dispatchHouseholdCommand({
      actorId: ownerActorId,
      invitationDigest,
      invitationRequestDigest: "d".repeat(64),
      linkageSubject: ownerLinkageSubject,
      mutationId: "link-associate-invitation",
      objectName,
      operation: "associateAdultInvitation",
      organizationId,
      personId,
    });
    expect(associated).toMatchObject({
      ok: true,
      value: { associationState: "invitation_pending", id: personId },
    });

    const linked = await dispatchHouseholdCommand({
      actorId: memberActorId,
      invitationDigest,
      linkageSubject: memberLinkageSubject,
      mutationId: "link-complete-accepted",
      objectName,
      operation: "completeAcceptedAdultLink",
      organizationId,
    });
    expect(linked).toMatchObject({ ok: false });

    const roster = await dispatchHouseholdCommand({
      actorId: ownerActorId,
      includeArchived: true,
      linkageSubject: ownerLinkageSubject,
      objectName,
      operation: "listHouseholdPeople",
      organizationId,
    });
    expect(roster).toMatchObject({
      ok: true,
      value: { roster: { people: expect.any(Array) } },
    });
    expect(
      (
        roster.value as {
          readonly roster: { readonly people: readonly unknown[] };
        }
      ).roster.people
    ).toHaveLength(2);
  });

  it("persists a coordinated departure through restart before detaching the adult", async () => {
    const organizationId = "org-person-departure-return";
    const objectName = await objectNameFor(organizationId);
    const ownerActorId = "6".repeat(64);
    const ownerLinkageSubject = "7".repeat(64);
    const memberActorId = "8".repeat(64);
    const memberLinkageSubject = "9".repeat(64);

    await dispatchHouseholdCommand({
      actorId: ownerActorId,
      displayName: "Household owner",
      linkageSubject: ownerLinkageSubject,
      mutationId: "departure-bootstrap-owner",
      objectName,
      operation: "bootstrapCreatorPerson",
      organizationId,
    });
    const created = await dispatchHouseholdCommand({
      actorId: ownerActorId,
      displayName: "Departing adult",
      kind: "adult",
      linkageSubject: ownerLinkageSubject,
      mutationId: "departure-create-adult",
      objectName,
      operation: "createHouseholdPerson",
      organizationId,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    const personId = (created.value as { readonly id: string }).id;
    const linked = await dispatchHouseholdCommand({
      actorId: ownerActorId,
      expectedPersonVersion: (created.value as { readonly version: number })
        .version,
      linkageSubject: ownerLinkageSubject,
      mutationId: "departure-repair-link",
      objectName,
      operation: "repairAdultAccountLink",
      organizationId,
      personId,
      reason: "Explicitly link the departing adult",
      targetLinkageSubject: memberLinkageSubject,
    });
    const linkedVersion = (linked.value as { readonly version: number })
      .version;

    const prepared = await dispatchHouseholdCommand({
      actorId: memberActorId,
      expectedLinkVersion: 1,
      expectedPersonVersion: linkedVersion,
      linkageSubject: memberLinkageSubject,
      mutationId: "departure-prepare",
      objectName,
      operation: "prepareMemberDeparture",
      organizationId,
      personId,
      reason: "Leaving this household",
      targetLinkageSubject: memberLinkageSubject,
    });
    expect(prepared).toMatchObject({
      ok: true,
      value: { personId, state: "prepared", version: 1 },
    });
    const { operationId } = prepared.value as { readonly operationId: string };

    const started = await dispatchHouseholdCommand({
      actorId: memberActorId,
      expectedOperationVersion: 1,
      linkageSubject: memberLinkageSubject,
      objectName,
      operation: "startMemberDeparture",
      operationId,
      organizationId,
    });
    expect(started).toMatchObject({
      ok: true,
      value: {
        attemptClaimed: true,
        operation: { state: "revoking_access", version: 2 },
      },
    });

    await runtime.dispose();
    runtime = makeRuntime();
    const persisted = await dispatchHouseholdCommand({
      objectName,
      operation: "readMemberDepartureSystem",
      operationId,
      organizationId,
    });
    expect(persisted).toMatchObject({
      ok: true,
      value: {
        operation: { state: "revoking_access", version: 2 },
        targetLinkageSubject: memberLinkageSubject,
      },
    });

    const accessRevoked = await dispatchHouseholdCommand({
      expectedOperationVersion: 2,
      objectName,
      operation: "confirmMemberAccessRevoked",
      operationId,
      organizationId,
    });
    expect(accessRevoked).toMatchObject({
      ok: true,
      value: { state: "access_revoked", version: 3 },
    });
    const finalized = await dispatchHouseholdCommand({
      expectedOperationVersion: 3,
      objectName,
      operation: "finalizeMemberDeparture",
      operationId,
      organizationId,
    });
    expect(finalized).toMatchObject({
      ok: true,
      value: { state: "completed", version: 4 },
    });

    const archivedRoster = await dispatchHouseholdCommand({
      actorId: ownerActorId,
      includeArchived: true,
      linkageSubject: ownerLinkageSubject,
      objectName,
      operation: "listHouseholdPeople",
      organizationId,
    });
    const archivedPerson = (
      archivedRoster.value as {
        readonly roster: {
          readonly people: readonly {
            readonly associationState: string;
            readonly id: string;
            readonly lifecycle: string;
            readonly version: number;
          }[];
        };
      }
    ).roster.people.find((person) => person.id === personId);
    expect(archivedPerson).toMatchObject({
      associationState: "detached",
      lifecycle: "archived",
    });
    if (archivedPerson === undefined) {
      throw new Error("Expected the departed adult to remain in the roster");
    }
  }, 30_000);

  it("preserves replay, lifecycle, races, restart, and household isolation", async () => {
    const organizationId = "org-person-registry-a";
    const objectName = await objectNameFor(organizationId);
    const actorId = "b".repeat(64);
    const linkageSubject = "c".repeat(64);
    const bootstrapCommand = {
      actorId,
      displayName: "Cillian",
      linkageSubject,
      mutationId: "person-bootstrap-a",
      objectName,
      operation: "bootstrapCreatorPerson",
      organizationId,
    };
    const objectSideDenial = await dispatchHouseholdCommand({
      ...bootstrapCommand,
      operation: "bootstrapCreatorPersonAsMember",
    });
    expect(objectSideDenial).toMatchObject({
      error: { _tag: "HouseholdInvalidInput" },
      ok: false,
    });
    const stateAfterDeniedBootstrap = await dispatchHouseholdCommand({
      objectName,
      operation: "inspectHouseholdPeopleState",
    });
    expect(stateAfterDeniedBootstrap).toMatchObject({
      ok: true,
      value: { associations: [], audits: [], people: [], receipts: [] },
    });
    const [bootstrap, concurrentReplay] = await Promise.all([
      dispatchHouseholdCommand(bootstrapCommand),
      dispatchHouseholdCommand(bootstrapCommand),
    ]);
    expect(concurrentReplay).toEqual(bootstrap);
    expect(bootstrap.ok).toBe(true);
    const creator = bootstrap.value as {
      readonly id: string;
      readonly version: number;
    };
    expect(creator).toMatchObject({
      isCurrentAdult: true,
      kind: "adult",
      lifecycle: "active",
      version: 1,
    });

    const collision = await dispatchHouseholdCommand({
      ...bootstrapCommand,
      displayName: "Different intent",
    });
    expect(collision).toMatchObject({
      error: { _tag: "HouseholdPersonMutationCollision" },
      ok: false,
    });

    const conflictingBootstrap = await dispatchHouseholdCommand({
      ...bootstrapCommand,
      actorId: "d".repeat(64),
      displayName: "Another creator",
      linkageSubject: "e".repeat(64),
      mutationId: "person-bootstrap-b",
    });
    expect(conflictingBootstrap).toMatchObject({
      error: { _tag: "HouseholdCreatorBootstrapConflict" },
      ok: false,
    });

    const dependant = await dispatchHouseholdCommand({
      actorId,
      displayName: "Household child",
      kind: "dependant",
      linkageSubject,
      mutationId: "person-create-child",
      objectName,
      operation: "createHouseholdPerson",
      organizationId,
    });
    expect(dependant).toMatchObject({
      ok: true,
      value: { isCurrentAdult: false, kind: "dependant", version: 1 },
    });
    const dependantId = (dependant.value as { readonly id: string }).id;

    const archiveCommand = {
      actorId,
      expectedVersion: 1,
      linkageSubject,
      mutationId: "person-archive-a",
      objectName,
      operation: "archiveHouseholdPerson",
      organizationId,
      personId: dependantId,
    };
    const [archiveFirst, archiveRace] = await Promise.all([
      dispatchHouseholdCommand(archiveCommand),
      dispatchHouseholdCommand({
        ...archiveCommand,
        mutationId: "person-archive-race",
      }),
    ]);
    const outcomes = [archiveFirst, archiveRace];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({
      error: { _tag: "HouseholdPersonStaleVersion" },
    });
    const archived = outcomes.find((outcome) => outcome.ok);
    if (archived === undefined) {
      throw new Error("Expected one archive winner.");
    }
    expect(archived.value).toMatchObject({ lifecycle: "archived", version: 2 });
    const successfulArchiveMutation = archiveFirst.ok
      ? "person-archive-a"
      : "person-archive-race";
    const archiveReplay = await dispatchHouseholdCommand({
      ...archiveCommand,
      mutationId: successfulArchiveMutation,
    });
    expect(archiveReplay).toEqual(archived);

    const restore = await dispatchHouseholdCommand({
      ...archiveCommand,
      expectedVersion: 2,
      mutationId: "person-restore-a",
      operation: "restoreHouseholdPerson",
    });
    expect(restore).toMatchObject({
      ok: true,
      value: { id: dependantId, lifecycle: "active", version: 3 },
    });

    await runtime.dispose();
    runtime = makeRuntime();
    const rosterAfterRestart = await dispatchHouseholdCommand({
      actorId,
      includeArchived: true,
      linkageSubject,
      objectName,
      operation: "listHouseholdPeople",
      organizationId,
    });
    expect(rosterAfterRestart).toMatchObject({
      ok: true,
      value: {
        roster: {
          creatorSlot: "occupied",
          currentPersonId: creator.id,
          people: [
            { id: creator.id, version: 1 },
            { id: dependantId, lifecycle: "active", version: 3 },
          ],
        },
      },
    });
    const persistedPeopleState = await dispatchHouseholdCommand({
      objectName,
      operation: "inspectHouseholdPeopleState",
    });
    expect(persistedPeopleState).toMatchObject({
      ok: true,
      value: {
        associations: [
          {
            linkageSubject,
            personId: creator.id,
            singletonKey: "creator",
          },
        ],
        audits: [
          {
            command: "bootstrap_creator",
            nextVersion: 1,
            personId: creator.id,
            sequence: 1,
          },
          {
            command: "create",
            nextVersion: 1,
            personId: dependantId,
            sequence: 2,
          },
          {
            command: "archive",
            nextVersion: 2,
            personId: dependantId,
            sequence: 3,
          },
          {
            command: "restore",
            nextVersion: 3,
            personId: dependantId,
            sequence: 4,
          },
        ],
        people: expect.arrayContaining([
          expect.objectContaining({ personId: creator.id, version: 1 }),
          expect.objectContaining({
            lifecycle: "active",
            personId: dependantId,
            version: 3,
          }),
        ]),
        receipts: expect.arrayContaining([
          { mutationId: "person-bootstrap-a" },
          { mutationId: "person-create-child" },
          { mutationId: successfulArchiveMutation },
          { mutationId: "person-restore-a" },
        ]),
      },
    });
    expect(
      (persistedPeopleState.value as { readonly receipts: readonly unknown[] })
        .receipts
    ).toHaveLength(4);

    const otherOrganizationId = "org-person-registry-b";
    const otherObjectName = await objectNameFor(otherOrganizationId);
    const isolatedRead = await dispatchHouseholdCommand({
      actorId,
      linkageSubject,
      objectName: otherObjectName,
      operation: "getHouseholdPerson",
      organizationId: otherOrganizationId,
      personId: dependantId,
    });
    expect(isolatedRead).toMatchObject({
      error: { _tag: "HouseholdPersonNotFound" },
      ok: false,
    });
    const isolatedMutationId = await dispatchHouseholdCommand({
      ...bootstrapCommand,
      objectName: otherObjectName,
      organizationId: otherOrganizationId,
    });
    expect(isolatedMutationId).toMatchObject({
      ok: true,
      value: { displayName: "Cillian" },
    });
  }, 30_000);

  it("physically rejects a second creator association in one household database", async () => {
    const organizationId = "org-person-creator-singleton-constraint";
    const objectName = await objectNameFor(organizationId);
    const result = await dispatchHouseholdCommand({
      objectName,
      operation: "proveCreatorAssociationSingletonConstraint",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        associations: [
          {
            linkageSubject: "a".repeat(64),
            personId: "person_00000000-0000-4000-8000-000000000001",
            singletonKey: "creator",
          },
        ],
        rejectedSecond: true,
      },
    });
  });
});
/* eslint-enable no-use-before-define */
const fixturePath = fileURLToPath(
  new URL("household-object-host.test-fixture.ts", import.meta.url)
);
const temporaryDirectories: string[] = [];
let runtime: Miniflare;
let fixtureManifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;
let persistenceDirectory: string;

const HouseholdEnsureResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: HouseholdMetadata,
  }),
  Schema.Struct({
    error: HouseholdDomainFailure,
    ok: Schema.Literal(false),
  }),
]);

const RecipeImportAdmissionResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: HouseholdAdmitRecipeImportResult,
  }),
  Schema.Struct({ error: Schema.Unknown, ok: Schema.Literal(false) }),
]);

const ImportWorkflowDispatchResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.NullOr(HouseholdImportWorkflowDispatchView),
  }),
  Schema.Struct({ error: Schema.Unknown, ok: Schema.Literal(false) }),
]);

const RecipePageResponse = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: HouseholdRecipePage }),
  Schema.Struct({ error: Schema.Unknown, ok: Schema.Literal(false) }),
]);

let privateOutputManifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;

const makeRuntime = () =>
  new Miniflare({
    cf: false,
    resourcePersistencePath: persistenceDirectory,
    workers: [
      {
        config: {
          compatibilityDate,
          compatibilityFlags,
          env: {
            ...privateOutputTestBindings,
            BrokenMigrationObject: {
              exportName: "BrokenMigrationObject",
              type: "durable-object",
              worker: "worker",
            },
            HouseholdObject: {
              exportName: "HouseholdObject",
              type: "durable-object",
              worker: "worker",
            },
          },
          exports: {
            BrokenMigrationObject: {
              storage: "sqlite",
              type: "durable-object",
            },
            HouseholdObject: { storage: "sqlite", type: "durable-object" },
          },
          manifest: fixtureManifest,
          name: "worker",
        },
      },
      privateOutputRuntimeWorker(privateOutputManifest),
    ],
  });

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-household-object-`
  );
  temporaryDirectories.push(temporaryDirectory);
  privateOutputManifest = await bundleWorkerFixture(
    fileURLToPath(
      new URL("../private-output/private-output-worker.ts", import.meta.url)
    ),
    temporaryDirectory
  );
  persistenceDirectory = `${temporaryDirectory}/durable-object-storage`;
  fixtureManifest = await bundleWorkerFixture(fixturePath, temporaryDirectory);
  runtime = makeRuntime();
}, 30_000);

afterAll(async () => {
  await runtime.dispose();
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

const objectNameFor = (organizationId: string) =>
  Effect.runPromise(
    Effect.gen(function* locateTestHousehold() {
      const locator = yield* HouseholdObjectLocator;
      return yield* locator.locate(
        Schema.decodeUnknownSync(HouseholdOrganizationId)(organizationId)
      );
    }).pipe(
      Effect.provide(HouseholdObjectLocator.layer),
      Effect.provide(HouseholdAuthorityServicesLive)
    )
  );

const admitRecipeImport = async (input: {
  readonly idempotencyKey: string;
  readonly objectName: string;
  readonly organizationId: string;
  readonly sourceUrl: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      idempotencyKey: input.idempotencyKey,
      objectName: input.objectName,
      operation: "admitRecipeImport",
      organizationId: input.organizationId,
      source: { kind: "tiktok", url: input.sourceUrl },
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(RecipeImportAdmissionResponse)(
    await response.json()
  );
};

const inspectImportWorkflowDispatch = async (
  objectName: string,
  dispatchId: string
) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      dispatchId,
      objectName,
      operation: "inspectImportWorkflowDispatch",
    }),
    method: "POST",
  });
  return Schema.decodeUnknownPromise(ImportWorkflowDispatchResponse)(
    await response.json()
  );
};

const corruptImportWorkflowDispatchState = async (input: {
  readonly dispatchId: string;
  readonly objectName: string;
  readonly state: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      ...input,
      operation: "corruptImportWorkflowDispatchState",
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return response.json();
};

const corruptHouseholdProvenanceCreatedAt = async (input: {
  readonly createdAtEpochMs: number;
  readonly objectName: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      ...input,
      operation: "corruptHouseholdProvenanceCreatedAt",
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return response.json();
};

const recordRecipeImportDispatch = async (input: {
  readonly dispatchId: string;
  readonly objectName: string;
  readonly organizationId: string;
  readonly outcome: "prepared" | "started" | "unavailable";
  readonly workflowIdentity: string;
}) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      ...input,
      operation: "recordRecipeImportDispatch",
      originalTrace: {
        correlationId: "00000000-0000-4000-8000-000000000188",
      },
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(ImportWorkflowDispatchResponse)(
    await response.json()
  );
};

const commandHousehold = async (objectName: string, organizationId: string) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({
      objectName,
      operation: "ensure",
      organizationId,
    }),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownPromise(HouseholdEnsureResponse)(
    await response.json()
  );
};

const dispatchHouseholdCommand = async (command: Record<string, unknown>) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify(command),
    method: "POST",
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    readonly error?: { readonly _tag?: string; readonly reason?: string };
    readonly ok: boolean;
    readonly value?: unknown;
  };
};

describe("household Durable Object", () => {
  it("owns the provider-free admission-to-confirmation tracer", async () => {
    const organizationId = "organization-recipe-import-tracer";
    const objectName = await objectNameFor(organizationId);

    const admitted = await dispatchHouseholdCommand({
      idempotencyKey: "tracer-admission",
      objectName,
      operation: "admitRecipeImport",
      organizationId,
      source: {
        kind: "tiktok",
        url: "https://www.tiktok.com/@mealplanner/video/7000000000000000001",
      },
    });
    expect(admitted, JSON.stringify(admitted)).toMatchObject({
      ok: true,
      value: {
        intent: { intentVersion: 1, status: "processing" },
        workflowIdentity: expect.stringMatching(
          /^import-acquisition:v1:[a-f\d]{64}$/u
        ),
      },
    });
    const admission = admitted.value as {
      readonly intent: { readonly id: string };
    };

    const resolved = await dispatchHouseholdCommand({
      canonicalSourceId: "tiktok:video:7000000000000000001",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000001",
      expectedGeneration: 1,
      intentId: admission.intent.id,
      mutationId: "1".repeat(64),
      objectName,
      operation: "resolveRecipeImportSource",
      organizationId,
      sourceKind: "video",
    });
    expect(resolved).toMatchObject({
      ok: true,
      value: { intentVersion: 2, status: "processing" },
    });

    const draft = await dispatchHouseholdCommand({
      evidenceFingerprint: "2".repeat(64),
      expectedGeneration: 1,
      extractionFingerprint: "3".repeat(64),
      intentId: admission.intent.id,
      mutationId: "4".repeat(64),
      objectName,
      operation: "commitRecipeImportDraft",
      organizationId,
      review: {
        answers: [],
        blockers: { invalidFields: [], unresolvedRequiredFields: [] },
        editableFields: ["name", "ingredients", "instructions", "tags"],
        recipe: makeRecipeContent({
          description: "Provider-free household tracer.",
          ingredients: [recipeIngredientFromText("1 local ingredient")],
          instructions: [recipeInstructionFromText("Cook locally.", 1)],
          name: "Household tracer stew",
        }),
        tags: {
          cuisines: ["Irish"],
          difficulty: "easy",
          leftovers: "one_meal",
          mealTypes: ["dinner"],
          totalTimeBand: "under_30_minutes",
        },
      },
    });
    expect(draft).toMatchObject({
      ok: true,
      value: {
        action: { actionVersion: 1, status: "active" },
        intent: { intentVersion: 3, status: "requires_action" },
      },
    });
    const active = draft.value as {
      readonly action: { readonly id: string };
      readonly intent: { readonly intentVersion: number };
    };

    const confirmed = await dispatchHouseholdCommand({
      actionId: active.action.id,
      expectedActionVersion: 1,
      idempotencyKey: "tracer-confirmation",
      intentId: admission.intent.id,
      objectName,
      operation: "confirmRecipeImportAction",
      organizationId,
    });
    expect(confirmed).toMatchObject({
      ok: true,
      value: {
        result: { recipeId: expect.any(String) },
        status: "succeeded",
      },
    });

    await runtime.dispose();
    runtime = makeRuntime();
    expect(
      await dispatchHouseholdCommand({
        actionId: active.action.id,
        expectedActionVersion: 1,
        idempotencyKey: "tracer-confirmation",
        intentId: admission.intent.id,
        objectName,
        operation: "confirmRecipeImportAction",
        organizationId,
      })
    ).toEqual(confirmed);
  });

  it("persists generation-fenced executor lifecycle transitions and replay across restart", async () => {
    const organizationId = "organization-recipe-import-lifecycle";
    const objectName = await objectNameFor(organizationId);
    const admitted = await dispatchHouseholdCommand({
      idempotencyKey: "lifecycle-admission",
      objectName,
      operation: "admitRecipeImport",
      organizationId,
      source: {
        kind: "tiktok",
        url: "https://www.tiktok.com/@mealplanner/video/7000000000000000201",
      },
    });
    const intentId = (
      admitted.value as { readonly intent: { readonly id: string } }
    ).intent.id;
    await dispatchHouseholdCommand({
      canonicalSourceId: "tiktok:video:7000000000000000201",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000201",
      expectedGeneration: 1,
      intentId,
      mutationId: "8".repeat(64),
      objectName,
      operation: "resolveRecipeImportSource",
      organizationId,
      sourceKind: "carousel",
    });

    const transition = (value: object, expectedGeneration = 1) =>
      dispatchHouseholdCommand({
        expectedGeneration,
        intentId,
        objectName,
        operation: "transitionRecipeImportLifecycle",
        organizationId,
        transition: value,
      });
    expect(
      await transition({ _tag: "AdvanceStage", stage: "analyzing_evidence" })
    ).toMatchObject({
      ok: true,
      value: {
        intentVersion: 3,
        processing: {
          speech: "not_started",
          type: "analyzing_evidence",
          visuals: "not_started",
        },
      },
    });
    await transition({
      _tag: "AdvanceComponent",
      component: "speech",
      progress: "processing",
    });
    await transition({
      _tag: "AdvanceComponent",
      component: "speech",
      progress: "completed",
    });
    await transition({
      _tag: "AdvanceComponent",
      component: "visuals",
      progress: "skipped",
    });
    expect(
      await transition({ _tag: "AdvanceStage", stage: "extracting_recipe" })
    ).toMatchObject({
      ok: true,
      value: {
        intentVersion: 7,
        processing: { type: "extracting_recipe" },
      },
    });
    const retrying = await transition({
      _tag: "SetActivity",
      activity: "retrying",
      attempt: 2,
      boundary: "recipe",
    });
    expect(retrying).toMatchObject({
      ok: true,
      value: { activity: { type: "retrying" }, intentVersion: 8 },
    });
    expect(
      await transition({
        _tag: "SetActivity",
        activity: "retrying",
        attempt: 2,
        boundary: "recipe",
      })
    ).toEqual(retrying);
    expect(
      await transition({ _tag: "AdvanceStage", stage: "grounding_recipe" }, 2)
    ).toMatchObject({ error: { reason: "generation_conflict" }, ok: false });

    await runtime.dispose();
    runtime = makeRuntime();
    expect(
      await dispatchHouseholdCommand({
        intentId,
        objectName,
        operation: "readRecipeImport",
        organizationId,
      })
    ).toMatchObject({
      ok: true,
      value: { activity: { type: "retrying" }, intentVersion: 8 },
    });
  });

  it("paginates more than 128 approved household recipes across restart", async () => {
    const organizationId = "organization-recipe-bank-pagination";
    const objectName = await objectNameFor(organizationId);
    await commandHousehold(objectName, organizationId);
    const seedResponse = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        count: 129,
        objectName,
        operation: "seedApprovedRecipes",
      }),
      method: "POST",
    });
    expect(await seedResponse.json()).toEqual({ ok: true });

    const listPage = async (cursor: string | null) => {
      const response = await runtime.dispatchFetch("http://localhost/", {
        body: JSON.stringify({
          byteLimit: 1_048_576,
          cursor,
          limit: 100,
          objectName,
          operation: "listRecipeBank",
          organizationId,
        }),
        method: "POST",
      });
      expect(response.status).toBe(200);
      return Schema.decodeUnknownPromise(RecipePageResponse)(
        await response.json()
      );
    };

    const first = await listPage(null);
    expect(first).toMatchObject({
      ok: true,
      value: { items: { length: 100 } },
    });
    if (!first.ok || first.value.nextCursor === null) {
      throw new Error("Expected a bounded first Recipe Bank page.");
    }

    await runtime.dispose();
    runtime = makeRuntime();
    const second = await listPage(first.value.nextCursor);
    expect(second).toMatchObject({
      ok: true,
      value: { items: { length: 29 }, nextCursor: null },
    });
  });

  it("releases terminal canonical-source ownership across restart", async () => {
    const organizationId = "organization-terminal-source-release";
    const objectName = await objectNameFor(organizationId);
    const admit = async (key: string, videoId: string) => {
      const result = await dispatchHouseholdCommand({
        idempotencyKey: key,
        objectName,
        operation: "admitRecipeImport",
        organizationId,
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@mealplanner/video/${videoId}`,
        },
      });
      return (result.value as { readonly intent: { readonly id: string } })
        .intent.id;
    };
    const canonicalSourceId = "tiktok:video:7000000000000000300";
    const canonicalUrl =
      "https://www.tiktok.com/@mealplanner/video/7000000000000000300";
    const firstIntentId = await admit(
      "terminal-source-first",
      "7000000000000000301"
    );
    const redirectedIntentId = await admit(
      "terminal-source-redirected",
      "7000000000000000302"
    );
    const initial = await Promise.all(
      [firstIntentId, redirectedIntentId].map((intentId, index) =>
        dispatchHouseholdCommand({
          canonicalSourceId,
          canonicalUrl,
          expectedGeneration: 1,
          intentId,
          mutationId: `${index + 1}`.repeat(64),
          objectName,
          operation: "resolveRecipeImportSource",
          organizationId,
          sourceKind: "video",
        })
      )
    );
    const liveOwner = initial.find(
      ({ value }) =>
        (value as { readonly status?: string } | undefined)?.status ===
        "processing"
    );
    expect(
      initial.map(
        ({ value }) =>
          (value as { readonly status?: string } | undefined)?.status
      )
    ).toEqual(expect.arrayContaining(["processing", "redirected"]));
    if (liveOwner === undefined) {
      throw new Error("Expected a live canonical-source owner.");
    }
    const liveOwnerIntent = liveOwner.value as {
      readonly id: string;
      readonly intentVersion: number;
    };
    expect(
      await dispatchHouseholdCommand({
        expectedIntentVersion: liveOwnerIntent.intentVersion,
        idempotencyKey: "terminal-source-cancel",
        intentId: liveOwnerIntent.id,
        objectName,
        operation: "cancelRecipeImport",
        organizationId,
      })
    ).toMatchObject({ ok: true, value: { status: "cancelled" } });

    await runtime.dispose();
    runtime = makeRuntime();
    const afterCancellationId = await admit(
      "terminal-source-after-cancel",
      "7000000000000000303"
    );
    expect(
      await dispatchHouseholdCommand({
        canonicalSourceId,
        canonicalUrl,
        expectedGeneration: 1,
        intentId: afterCancellationId,
        mutationId: "a".repeat(64),
        objectName,
        operation: "resolveRecipeImportSource",
        organizationId,
        sourceKind: "video",
      })
    ).toMatchObject({ ok: true, value: { status: "processing" } });
    expect(
      await dispatchHouseholdCommand({
        expectedGeneration: 1,
        intentId: afterCancellationId,
        objectName,
        operation: "transitionRecipeImportLifecycle",
        organizationId,
        transition: {
          _tag: "Fail",
          attemptIdentity: "terminal-source-after-cancel:acquisition:1",
          boundary: "acquisition",
          code: "source_unavailable",
          message: "The source became unavailable.",
          recovery: "create_new_intent",
        },
      })
    ).toMatchObject({ ok: true, value: { status: "failed" } });

    await runtime.dispose();
    runtime = makeRuntime();
    const afterFailureId = await admit(
      "terminal-source-after-failure",
      "7000000000000000304"
    );
    expect(
      await dispatchHouseholdCommand({
        canonicalSourceId,
        canonicalUrl,
        expectedGeneration: 1,
        intentId: afterFailureId,
        mutationId: "b".repeat(64),
        objectName,
        operation: "resolveRecipeImportSource",
        organizationId,
        sourceKind: "video",
      })
    ).toMatchObject({ ok: true, value: { status: "processing" } });
  });

  it("rejects an oversized correction and keeps the largest bounded recipe usable across restart", async () => {
    const organizationId = "organization-recipe-bank-byte-bound";
    const objectName = await objectNameFor(organizationId);
    const prepareReview = async (key: string, videoId: string) => {
      const admitted = await dispatchHouseholdCommand({
        idempotencyKey: `${key}-admit`,
        objectName,
        operation: "admitRecipeImport",
        organizationId,
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@mealplanner/video/${videoId}`,
        },
      });
      const intentId = (
        admitted.value as { readonly intent: { readonly id: string } }
      ).intent.id;
      await dispatchHouseholdCommand({
        canonicalSourceId: `tiktok:video:${videoId}`,
        canonicalUrl: `https://www.tiktok.com/@mealplanner/video/${videoId}`,
        expectedGeneration: 1,
        intentId,
        mutationId: key.at(0)?.repeat(64),
        objectName,
        operation: "resolveRecipeImportSource",
        organizationId,
        sourceKind: "video",
      });
      const draft = await dispatchHouseholdCommand({
        evidenceFingerprint: "c".repeat(64),
        expectedGeneration: 1,
        extractionFingerprint: "d".repeat(64),
        intentId,
        mutationId: key.at(-1)?.repeat(64),
        objectName,
        operation: "commitRecipeImportDraft",
        organizationId,
        review: recipeImportReview(`${key} recipe`),
      });
      return {
        actionId: (draft.value as { readonly action: { readonly id: string } })
          .action.id,
        intentId,
      };
    };

    const oversized = await prepareReview("ef", "7000000000000000401");
    const oversizedAnswer = await dispatchHouseholdCommand({
      actionId: oversized.actionId,
      answers: [
        {
          field: "ingredients",
          value: Array.from({ length: 64 }, () =>
            recipeIngredientFromText("x".repeat(4000))
          ),
        },
      ],
      expectedActionVersion: 1,
      idempotencyKey: "oversized-correction",
      intentId: oversized.intentId,
      objectName,
      operation: "answerRecipeImportAction",
      organizationId,
    });
    expect(
      oversizedAnswer,
      JSON.stringify(oversizedAnswer.error)
    ).toMatchObject({ ok: true });
    expect(
      await dispatchHouseholdCommand({
        actionId: oversized.actionId,
        expectedActionVersion: 2,
        idempotencyKey: "oversized-confirmation",
        intentId: oversized.intentId,
        objectName,
        operation: "confirmRecipeImportAction",
        organizationId,
      })
    ).toMatchObject({ error: { reason: "invalid_input" }, ok: false });

    const bounded = await prepareReview("ab", "7000000000000000402");
    const boundedIngredients = Array.from({ length: 60 }, () =>
      recipeIngredientFromText("y".repeat(4000))
    );
    expect(
      await dispatchHouseholdCommand({
        actionId: bounded.actionId,
        answers: [{ field: "ingredients", value: boundedIngredients }],
        expectedActionVersion: 1,
        idempotencyKey: "bounded-correction",
        intentId: bounded.intentId,
        objectName,
        operation: "answerRecipeImportAction",
        organizationId,
      })
    ).toMatchObject({ ok: true });
    expect(
      await dispatchHouseholdCommand({
        actionId: bounded.actionId,
        expectedActionVersion: 2,
        idempotencyKey: "bounded-confirmation",
        intentId: bounded.intentId,
        objectName,
        operation: "confirmRecipeImportAction",
        organizationId,
      })
    ).toMatchObject({ ok: true, value: { status: "succeeded" } });

    await runtime.dispose();
    runtime = makeRuntime();
    const listed: unknown[] = [];
    let cursor: string | null = null;
    do {
      // eslint-disable-next-line no-await-in-loop -- Each bounded page depends on the preceding exclusive cursor.
      const page = await dispatchHouseholdCommand({
        byteLimit: 524_288,
        cursor,
        limit: 100,
        objectName,
        operation: "listRecipeBank",
        organizationId,
      });
      expect(page.ok, JSON.stringify(page.error)).toBe(true);
      const value = page.value as {
        readonly items: readonly unknown[];
        readonly nextCursor: string | null;
      };
      listed.push(...value.items);
      cursor = value.nextCursor;
    } while (cursor !== null);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      recipe: { ingredients: { length: boundedIngredients.length } },
    });
  });

  it("settles deduplication, stale fences, cancel-confirm races, and mutation collisions across restart", async () => {
    const organizationId = "organization-recipe-import-races";
    const objectName = await objectNameFor(organizationId);
    const admit = (key: string, videoId: string) =>
      dispatchHouseholdCommand({
        idempotencyKey: key,
        objectName,
        operation: "admitRecipeImport",
        organizationId,
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@mealplanner/video/${videoId}`,
        },
      });
    const first = await admit("dedup-first", "7000000000000000101");
    const second = await admit("dedup-second", "7000000000000000102");
    const firstIntentId = (
      first.value as { readonly intent: { readonly id: string } }
    ).intent.id;
    const secondIntentId = (
      second.value as { readonly intent: { readonly id: string } }
    ).intent.id;
    expect(
      await dispatchHouseholdCommand({
        idempotencyKey: "dedup-first",
        objectName,
        operation: "admitRecipeImport",
        organizationId,
        source: {
          kind: "tiktok",
          url: "https://www.tiktok.com/@mealplanner/video/7999999999999999999",
        },
      })
    ).toMatchObject({
      error: { reason: "idempotency_conflict" },
      ok: false,
    });

    const canonicalSourceId = "tiktok:video:7000000000000000199";
    const resolutions = await Promise.all(
      [firstIntentId, secondIntentId].map((intentId, index) =>
        dispatchHouseholdCommand({
          canonicalSourceId,
          canonicalUrl:
            "https://www.tiktok.com/@mealplanner/video/7000000000000000199",
          expectedGeneration: 1,
          intentId,
          mutationId: `${index + 1}`.repeat(64),
          objectName,
          operation: "resolveRecipeImportSource",
          organizationId,
          sourceKind: "video",
        })
      )
    );
    expect(
      resolutions.map((result) =>
        result.ok
          ? (result.value as { readonly status: string }).status
          : result.error?.reason
      )
    ).toEqual(expect.arrayContaining(["processing", "redirected"]));
    const winner = resolutions.find(
      (result) =>
        result.ok &&
        (result.value as { readonly status: string }).status === "processing"
    );
    if (winner === undefined) {
      throw new Error("Expected one canonical source winner.");
    }
    const winnerIntentId = (winner.value as { readonly id: string }).id;
    expect(
      await dispatchHouseholdCommand({
        evidenceFingerprint: "3".repeat(64),
        expectedGeneration: 2,
        extractionFingerprint: "4".repeat(64),
        intentId: winnerIntentId,
        mutationId: "5".repeat(64),
        objectName,
        operation: "commitRecipeImportDraft",
        organizationId,
        review: {
          answers: [],
          blockers: { invalidFields: [], unresolvedRequiredFields: [] },
          editableFields: ["name", "ingredients", "instructions", "tags"],
          recipe: makeRecipeContent({
            ingredients: [recipeIngredientFromText("1 race-safe ingredient")],
            instructions: [recipeInstructionFromText("Cook safely.", 1)],
            name: "Race-safe stew",
          }),
          tags: {
            cuisines: ["Irish"],
            difficulty: "easy",
            leftovers: "one_meal",
            mealTypes: ["dinner"],
            totalTimeBand: "under_30_minutes",
          },
        },
      })
    ).toMatchObject({ error: { reason: "generation_conflict" }, ok: false });

    const seedCollision = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        count: 1,
        objectName,
        operation: "seedApprovedRecipes",
      }),
      method: "POST",
    });
    expect(await seedCollision.json()).toEqual({ ok: true });
    const rollbackDraft = await dispatchHouseholdCommand({
      evidenceFingerprint: "a".repeat(64),
      expectedGeneration: 1,
      extractionFingerprint: "b".repeat(64),
      intentId: winnerIntentId,
      mutationId: "c".repeat(64),
      objectName,
      operation: "commitRecipeImportDraft",
      organizationId,
      review: {
        answers: [],
        blockers: { invalidFields: [], unresolvedRequiredFields: [] },
        editableFields: ["name", "ingredients", "instructions", "tags"],
        recipe: makeRecipeContent({
          ingredients: [recipeIngredientFromText("1 rollback ingredient")],
          instructions: [recipeInstructionFromText("Commit atomically.", 1)],
          name: "Rollback stew",
        }),
        tags: {
          cuisines: ["Irish"],
          difficulty: "easy",
          leftovers: "one_meal",
          mealTypes: ["dinner"],
          totalTimeBand: "under_30_minutes",
        },
      },
    });
    const rollbackActionId = (
      rollbackDraft.value as { readonly action: { readonly id: string } }
    ).action.id;
    expect(
      await dispatchHouseholdCommand({
        actionId: rollbackActionId,
        expectedActionVersion: 1,
        idempotencyKey: "forced-precommit-failure",
        intentId: winnerIntentId,
        objectName,
        operation: "confirmRecipeImportActionWithRecipeId",
        organizationId,
        recipeId: "10000000-0000-4000-8000-000000000001",
      })
    ).toMatchObject({
      error: { reason: "persistence_unavailable" },
      ok: false,
    });
    expect(
      await dispatchHouseholdCommand({
        intentId: winnerIntentId,
        objectName,
        operation: "readRecipeImport",
        organizationId,
      })
    ).toMatchObject({ ok: true, value: { status: "requires_action" } });
    expect(
      await dispatchHouseholdCommand({
        actionId: rollbackActionId,
        expectedActionVersion: 1,
        idempotencyKey: "post-rollback-confirm",
        intentId: winnerIntentId,
        objectName,
        operation: "confirmRecipeImportAction",
        organizationId,
      })
    ).toMatchObject({ ok: true, value: { status: "succeeded" } });

    const raceImport = await admit("terminal-race", "7000000000000000103");
    const raceIntentId = (
      raceImport.value as { readonly intent: { readonly id: string } }
    ).intent.id;
    await dispatchHouseholdCommand({
      canonicalSourceId: "tiktok:video:7000000000000000103",
      canonicalUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000103",
      expectedGeneration: 1,
      intentId: raceIntentId,
      mutationId: "6".repeat(64),
      objectName,
      operation: "resolveRecipeImportSource",
      organizationId,
      sourceKind: "video",
    });
    const draft = await dispatchHouseholdCommand({
      evidenceFingerprint: "7".repeat(64),
      expectedGeneration: 1,
      extractionFingerprint: "8".repeat(64),
      intentId: raceIntentId,
      mutationId: "9".repeat(64),
      objectName,
      operation: "commitRecipeImportDraft",
      organizationId,
      review: {
        answers: [],
        blockers: { invalidFields: [], unresolvedRequiredFields: [] },
        editableFields: ["name", "ingredients", "instructions", "tags"],
        recipe: makeRecipeContent({
          ingredients: [recipeIngredientFromText("1 local ingredient")],
          instructions: [recipeInstructionFromText("Cook locally.", 1)],
          name: "Terminal race stew",
        }),
        tags: {
          cuisines: ["Irish"],
          difficulty: "easy",
          leftovers: "one_meal",
          mealTypes: ["dinner"],
          totalTimeBand: "under_30_minutes",
        },
      },
    });
    const actionId = (
      draft.value as { readonly action: { readonly id: string } }
    ).action.id;
    expect(
      await dispatchHouseholdCommand({
        actionId,
        expectedActionVersion: 2,
        idempotencyKey: "stale-confirm",
        intentId: raceIntentId,
        objectName,
        operation: "confirmRecipeImportAction",
        organizationId,
      })
    ).toMatchObject({ error: { reason: "version_conflict" }, ok: false });

    const [cancelled, confirmed] = await Promise.all([
      dispatchHouseholdCommand({
        expectedIntentVersion: 3,
        idempotencyKey: "race-cancel",
        intentId: raceIntentId,
        objectName,
        operation: "cancelRecipeImport",
        organizationId,
      }),
      dispatchHouseholdCommand({
        actionId,
        expectedActionVersion: 1,
        idempotencyKey: "race-confirm",
        intentId: raceIntentId,
        objectName,
        operation: "confirmRecipeImportAction",
        organizationId,
      }),
    ]);
    expect([cancelled, confirmed].filter(({ ok }) => ok)).toHaveLength(1);
    const terminal = cancelled.ok ? cancelled : confirmed;
    const terminalStatus = (terminal.value as { readonly status: string })
      .status;

    await runtime.dispose();
    runtime = makeRuntime();
    const persisted = await dispatchHouseholdCommand({
      intentId: raceIntentId,
      objectName,
      operation: "readRecipeImport",
      organizationId,
    });
    expect(persisted).toMatchObject({
      ok: true,
      value: { status: terminalStatus },
    });
    const collision = cancelled.ok
      ? await dispatchHouseholdCommand({
          expectedIntentVersion: 2,
          idempotencyKey: "race-cancel",
          intentId: raceIntentId,
          objectName,
          operation: "cancelRecipeImport",
          organizationId,
        })
      : await dispatchHouseholdCommand({
          actionId,
          expectedActionVersion: 2,
          idempotencyKey: "race-confirm",
          intentId: raceIntentId,
          objectName,
          operation: "confirmRecipeImportAction",
          organizationId,
        });
    expect(collision).toMatchObject({
      error: { reason: "idempotency_conflict" },
      ok: false,
    });
  });

  it("initializes once and rejects a conflicting organization provenance", async () => {
    const objectName = await objectNameFor("organization-a");
    const initial = await commandHousehold(objectName, "organization-a");
    const replay = await commandHousehold(objectName, "organization-a");

    expect(initial).toMatchObject({ ok: true });
    if (!initial.ok) {
      throw new Error("Expected household initialization to succeed.");
    }
    if (!Schema.is(HouseholdMetadata)(initial.value)) {
      throw new Error("Expected household metadata from initialization.");
    }
    expect(initial.value).toEqual({
      createdAtEpochMs: expect.any(Number),
      organizationId: "organization-a",
    });
    expect(replay).toEqual(initial);

    const mismatch = await commandHousehold(objectName, "organization-b");
    expect(mismatch).toMatchObject({ ok: false });
    if (mismatch.ok) {
      throw new Error("Expected conflicting household provenance to fail.");
    }
    expect(mismatch.error).toEqual({ _tag: "HouseholdProvenanceMismatch" });
    expect(JSON.stringify(mismatch.error)).not.toContain("organization-");
  });

  it("re-decodes and rejects a malformed internal command at the object boundary", async () => {
    const objectName = await objectNameFor("organization-malformed-object");
    const response = await runtime.dispatchFetch("http://localhost/", {
      body: JSON.stringify({
        objectName,
        operation: "invokeMalformedEnsure",
        payload: {
          admission: {
            actor: { _tag: "Member", actorId: "a".repeat(64) },
            organizationId: "organization-malformed-object",
          },
          unexpectedAuthority: true,
        },
      }),
      method: "POST",
    });
    await expect(response.json()).resolves.toEqual({
      error: { _tag: "HouseholdInvalidInput" },
      ok: false,
    });
  });

  it("rejects corrupt persisted household provenance metadata", async () => {
    const organizationId = "organization-corrupt-provenance";
    const objectName = await objectNameFor(organizationId);
    expect(await commandHousehold(objectName, organizationId)).toMatchObject({
      ok: true,
    });

    await corruptHouseholdProvenanceCreatedAt({
      createdAtEpochMs: -1,
      objectName,
    });

    expect(await commandHousehold(objectName, organizationId)).toEqual({
      error: { _tag: "HouseholdPersistenceFailure", operation: "read" },
      ok: false,
    });
  });

  it("fails closed and repeatably when a per-object migration cannot apply", async () => {
    const probe = async () => {
      const response = await runtime.dispatchFetch("http://localhost/", {
        body: JSON.stringify({
          objectName: "broken-migration-proof",
          operation: "probeMigrationFailure",
        }),
        method: "POST",
      });
      return response.json();
    };

    expect(await probe()).toMatchObject({ ok: false });
    expect(await probe()).toMatchObject({ ok: false });
  });

  it("keeps a committed import admission final across dispatch exhaustion, replay, and restart", async () => {
    const organizationId = "organization-workflow-admission";
    const objectName = await objectNameFor(organizationId);
    const initialInput = {
      idempotencyKey: "workflow-admission-restart-proof",
      objectName,
      organizationId,
      sourceUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000101",
    } as const;

    const committed = await admitRecipeImport(initialInput);
    if (!committed.ok) {
      throw new Error(
        `Expected recipe import admission to commit: ${JSON.stringify(committed.error)}`
      );
    }
    expect(committed.value.workflowIdentity).toMatch(
      /^import-acquisition:v1:[a-f\d]{64}$/u
    );
    expect(committed.value.workflowIdentity).not.toContain(
      committed.value.intent.id
    );
    expect(JSON.stringify(committed.value)).not.toContain(organizationId);

    const replay = await admitRecipeImport(initialInput);
    expect(replay).toEqual(committed);

    const pending = await inspectImportWorkflowDispatch(
      objectName,
      committed.value.dispatchId
    );
    expect(pending).toEqual({
      ok: true,
      value: {
        admission: expect.objectContaining({
          dispatchId: committed.value.dispatchId,
          workflowIdentity: committed.value.workflowIdentity,
        }),
        attempts: 0,
        exhaustedAtEpochMs: null,
        state: "pending",
      },
    });

    const unavailableAttempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordRecipeImportDispatch({
          dispatchId: committed.value.dispatchId,
          objectName,
          organizationId,
          outcome: "unavailable",
          workflowIdentity: committed.value.workflowIdentity,
        })
      )
    );
    for (const unavailable of unavailableAttempts) {
      expect(unavailable).toMatchObject({ ok: true });
    }
    const exhausted = await inspectImportWorkflowDispatch(
      objectName,
      committed.value.dispatchId
    );
    expect(exhausted).toMatchObject({
      ok: true,
      value: {
        admission: expect.objectContaining({
          dispatchId: committed.value.dispatchId,
          workflowIdentity: committed.value.workflowIdentity,
        }),
        attempts: 5,
        state: "exhausted",
      },
    });

    await runtime.dispose();
    runtime = makeRuntime();
    expect(await admitRecipeImport(initialInput)).toEqual(committed);
    expect(
      await inspectImportWorkflowDispatch(
        objectName,
        committed.value.dispatchId
      )
    ).toMatchObject({
      ok: true,
      value: { attempts: 5, state: "exhausted" },
    });

    const nextImport = await admitRecipeImport({
      ...initialInput,
      idempotencyKey: "workflow-admission-next-import-proof",
      sourceUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000102",
    });
    expect(nextImport).toMatchObject({ ok: true });
    if (!nextImport.ok) {
      throw new Error("Expected a new recipe import to commit.");
    }
    expect(nextImport.value.workflowIdentity).not.toBe(
      committed.value.workflowIdentity
    );
  });

  it("rejects corrupt persisted outbox projections at the repository boundary", async () => {
    const organizationId = "organization-workflow-corrupt-outbox";
    const objectName = await objectNameFor(organizationId);
    const committed = await admitRecipeImport({
      idempotencyKey: "corrupt-outbox-projection-proof",
      objectName,
      organizationId,
      sourceUrl:
        "https://www.tiktok.com/@mealplanner/video/7000000000000000103",
    });
    if (!committed.ok) {
      throw new Error("Expected corrupt outbox fixture admission to commit.");
    }

    await corruptImportWorkflowDispatchState({
      dispatchId: committed.value.dispatchId,
      objectName,
      state: "caller-invented-state",
    });

    expect(
      await inspectImportWorkflowDispatch(
        objectName,
        committed.value.dispatchId
      )
    ).toMatchObject({
      error: { _tag: "HouseholdWorkflowAdmissionPersistenceFailure" },
      ok: false,
    });
  });

  it("persists planning content receipts and plan decisions across restart", async () => {
    const organizationId = "organization-new-planning-persistence";
    const objectName = await objectNameFor(organizationId);
    const actorId = "c".repeat(64);
    const linkageSubject = "d".repeat(64);
    const scope = { actorId, linkageSubject, objectName, organizationId };
    const creator = await dispatchHouseholdCommand({
      ...scope,
      displayName: "Planning Adult",
      mutationId: "bootstrap-planning-adult",
      operation: "bootstrapCreatorPerson",
    });
    expect(creator).toMatchObject({ ok: true });
    const personId = (creator.value as { readonly id: string }).id;
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "createMealPlan",
        request: {
          requestKey: "plan-before-coverage",
          startDate: "2026-10-05",
          weeks: 1,
        },
      })
    ).toMatchObject({ error: { reason: "config_missing" }, ok: false });
    const contentPayload = {
      command: {
        _tag: "SetManagedOccasions",
        entries: [
          {
            label: "Dinner",
            occasionId: "dinner-main",
            personId,
            state: "managed",
            weekdays: [1],
          },
        ],
      },
      expectedVersion: 0,
      mutationId: "planning-content-mutation-001",
    };
    const content = await dispatchHouseholdCommand({
      ...scope,
      operation: "mutatePlanningContent",
      payload: contentPayload,
    });
    expect(content).toMatchObject({ ok: true, value: { configVersion: 1 } });
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "mutatePlanningContent",
        payload: contentPayload,
      })
    ).toEqual(content);
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "mutatePlanningContent",
        payload: {
          ...contentPayload,
          command: { _tag: "SetManagedOccasions", entries: [] },
        },
      })
    ).toMatchObject({ error: { reason: "mutation_collision" }, ok: false });
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "mutatePlanningContent",
        payload: {
          ...contentPayload,
          mutationId: "planning-content-stale-002",
        },
      })
    ).toMatchObject({ error: { reason: "stale_version" }, ok: false });

    const plan = await dispatchHouseholdCommand({
      ...scope,
      operation: "createMealPlan",
      request: {
        requestKey: "plan-native-001",
        startDate: "2026-10-05",
        weeks: 1,
      },
    });
    expect(plan).toMatchObject({
      ok: true,
      value: { _tag: "Draft", revision: 0 },
    });
    const { planId } = plan.value as { readonly planId: string };
    const changed = await dispatchHouseholdCommand({
      ...scope,
      operation: "changeMealPlan",
      payload: {
        change: {
          _tag: "SetCoverage",
          requirement: {
            date: "2026-10-05",
            occasion: "dinner-main",
            personId,
          },
          resolution: {
            _tag: "External",
            description: "Dinner with family",
            rationale: "Confirmed by the adult.",
          },
        },
        expectedRevision: 0,
        mutationId: "plan-change-001",
        reason: "Choose an explicit meal outside the app.",
      },
      planId,
    });
    expect(changed).toMatchObject({
      ok: true,
      value: { _tag: "Draft", revision: 1 },
    });
    const approved = await dispatchHouseholdCommand({
      ...scope,
      operation: "approveMealPlan",
      payload: {
        expectedRevision: 1,
        mutationId: "plan-approve-001",
        reason: "Adult reviewed the plan.",
      },
      planId,
    });
    expect(approved, JSON.stringify(approved)).toMatchObject({
      ok: true,
      value: { _tag: "Approved", revision: 2 },
    });
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "approveMealPlan",
        payload: {
          expectedRevision: 1,
          mutationId: "plan-approve-001",
          reason: "Adult reviewed the plan.",
        },
        planId,
      })
    ).toEqual(approved);
    await runtime.dispose();
    runtime = makeRuntime();
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "readPlanningContent",
      })
    ).toMatchObject({ ok: true, value: { configVersion: 1 } });
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "readMealPlan",
        planId,
      })
    ).toEqual(approved);
    expect(
      await dispatchHouseholdCommand({
        count: 1,
        objectName,
        operation: "seedApprovedRecipes",
      })
    ).toMatchObject({ ok: true });
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "listSavedRecipes",
        query: {},
      })
    ).toMatchObject({
      ok: true,
      value: { items: [{ name: "Approved recipe 1" }], nextCursor: null },
    });
  });

  it("reserves prepared food with approval and releases it on accepted revision", async () => {
    const organizationId = "organization-stock-transaction";
    const objectName = await objectNameFor(organizationId);
    const scope = {
      actorId: "e".repeat(64),
      linkageSubject: "f".repeat(64),
      objectName,
      organizationId,
    };
    const creator = await dispatchHouseholdCommand({
      ...scope,
      displayName: "Stock Adult",
      mutationId: "bootstrap-stock-adult",
      operation: "bootstrapCreatorPerson",
    });
    expect(creator, JSON.stringify(creator)).toMatchObject({ ok: true });
    const personId = (creator.value as { readonly id: string }).id;
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "mutatePersonProfile",
        payload: {
          command: {
            _tag: "AddConfirmedProfileFact",
            basis: "self",
            fact: { _tag: "NoKnownHardConstraints" },
          },
          expectedProfileVersion: 0,
          mutationId: "stock-confirm-no-known-constraints",
        },
        personId,
      })
    ).toMatchObject({ ok: true, value: { version: 1 } });
    const mutateContent = (
      expectedVersion: number,
      mutationId: string,
      command: object
    ) =>
      dispatchHouseholdCommand({
        ...scope,
        operation: "mutatePlanningContent",
        payload: { command, expectedVersion, mutationId },
      });
    expect(
      await mutateContent(0, "stock-occasion-001", {
        _tag: "SetManagedOccasions",
        entries: [
          {
            label: "Dinner",
            occasionId: "dinner-stock",
            personId,
            state: "managed",
            weekdays: [1],
          },
        ],
      })
    ).toMatchObject({ ok: true, value: { configVersion: 1 } });
    const preparedPortion = {
      confirmedForWeekStart: "2026-10-05",
      id: "portion-stock-001",
      label: "Confirmed leftover",
      quantity: {
        _tag: "Known",
        amount: 1,
        sourceText: null,
        unit: "portion",
      },
      reason: "Adult counted the prepared portion.",
      remainingAmount: 1,
      sourceCookEventId: null,
      sourceOptionRef: null,
      state: "available",
      storage: "fridge",
      version: 1,
    };
    expect(
      await mutateContent(1, "stock-portion-001", {
        _tag: "PutPreparedPortion",
        value: preparedPortion,
      })
    ).toMatchObject({ ok: true, value: { configVersion: 2 } });
    const createDraft = async (requestKey: string) => {
      const created = await dispatchHouseholdCommand({
        ...scope,
        operation: "createMealPlan",
        request: { requestKey, startDate: "2026-10-05", weeks: 1 },
      });
      expect(created, JSON.stringify(created)).toMatchObject({
        ok: true,
        value: { _tag: "Draft" },
      });
      const { planId } = created.value as { readonly planId: string };
      const changed = await dispatchHouseholdCommand({
        ...scope,
        operation: "changeMealPlan",
        payload: {
          change: {
            _tag: "SetCoverage",
            requirement: {
              date: "2026-10-05",
              occasion: "dinner-stock",
              personId,
            },
            resolution: {
              _tag: "Prepared",
              outputId: "portion-stock-001",
              quantity: { amount: 1, unit: "portion" },
              rationale: "Adult confirmed the stock.",
            },
          },
          expectedRevision: 0,
          mutationId: `${requestKey}-change`,
          reason: "Use the counted portion.",
        },
        planId,
      });
      expect(changed, JSON.stringify(changed)).toMatchObject({
        ok: true,
        value: { revision: 1 },
      });
      return planId;
    };
    const approve = (planId: string, mutationId: string) =>
      dispatchHouseholdCommand({
        ...scope,
        operation: "approveMealPlan",
        payload: {
          expectedRevision: 1,
          mutationId,
          reason: "Adult reviewed stock and meals.",
        },
        planId,
      });
    const unreviewedId = await createDraft("plan-stock-unreviewed");
    expect(
      await approve(unreviewedId, "plan-stock-unreviewed-approve")
    ).toMatchObject({
      error: { reason: "unreviewed_suitability" },
      ok: false,
    });
    const unreviewedPlan = await dispatchHouseholdCommand({
      ...scope,
      operation: "readMealPlan",
      planId: unreviewedId,
    });
    expect(unreviewedPlan).toMatchObject({
      ok: true,
      value: { _tag: "Draft" },
    });
    const pinnedProfileVersion = (
      unreviewedPlan.value as {
        readonly proposed: {
          readonly pins: {
            readonly people: readonly {
              readonly personId: string;
              readonly profileVersion: number;
            }[];
          };
        };
      }
    ).proposed.pins.people.find(
      (person) => person.personId === personId
    )?.profileVersion;
    expect(pinnedProfileVersion).toBeDefined();
    const sourceOptionRef = {
      kind: "packaged",
      optionId: "option-stock-source",
      optionVersion: 1,
    };
    expect(
      await mutateContent(2, "stock-source-option-001", {
        _tag: "PutOption",
        value: {
          ...sourceOptionRef,
          cover: null,
          label: "Counted prepared food source",
          preparation: {
            attention: "low",
            cleanup: "low",
            elapsedTime: { _tag: "Known", minutes: 0 },
            handsOnTime: { _tag: "Known", minutes: 0 },
            requiredEquipment: [],
            startRequirement: "none",
            substantialCookEvent: "no",
          },
          productIdentity: "stock-source-001",
          productName: "Counted prepared food source",
          quantity: {
            _tag: "Known",
            amount: 1,
            sourceText: null,
            unit: "portion",
          },
          substitutionPolicy: "exact_only",
        },
      })
    ).toMatchObject({ ok: true, value: { configVersion: 3 } });
    expect(
      await mutateContent(3, "stock-source-review-001", {
        _tag: "PutSuitabilityReview",
        value: {
          confirmation: "I reviewed this food for this person",
          id: "review-stock-source-001",
          optionRef: sourceOptionRef,
          personId,
          profileVersion: pinnedProfileVersion,
          reason: "Adult reviewed this exact food source for the person.",
          status: "compatible",
          version: 1,
        },
      })
    ).toMatchObject({ ok: true, value: { configVersion: 4 } });
    expect(
      await mutateContent(4, "stock-portion-source-001", {
        _tag: "PutPreparedPortion",
        value: {
          ...preparedPortion,
          reason: "Adult linked the counted portion to its reviewed source.",
          sourceOptionRef,
          version: 2,
        },
      })
    ).toMatchObject({ ok: true, value: { configVersion: 5 } });
    const firstId = await createDraft("plan-stock-001");
    const secondId = await createDraft("plan-stock-002");
    const firstApproval = await approve(firstId, "plan-stock-001-approve");
    expect(firstApproval, JSON.stringify(firstApproval)).toMatchObject({
      ok: true,
      value: { _tag: "Approved" },
    });
    expect(await approve(secondId, "plan-stock-002-approve")).toMatchObject({
      error: { reason: "config_version_changed" },
      ok: false,
    });
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "readMealPlan",
        planId: secondId,
      })
    ).toMatchObject({ ok: true, value: { _tag: "Draft", revision: 1 } });
    const content = await dispatchHouseholdCommand({
      ...scope,
      operation: "readPlanningContent",
    });
    expect(content).toMatchObject({
      ok: true,
      value: {
        preparedPortions: [{ reservations: [{ amount: 1, planId: firstId }] }],
      },
    });
    const revision = await dispatchHouseholdCommand({
      ...scope,
      operation: "proposeMealPlanRevision",
      payload: {
        expectedRevision: 2,
        mutationId: "stock-revision-propose",
        reason: "Change this dinner.",
      },
      planId: firstId,
    });
    expect(revision, JSON.stringify(revision)).toMatchObject({
      ok: true,
      value: { _tag: "ProposedRevision" },
    });
    const replacement = await dispatchHouseholdCommand({
      ...scope,
      operation: "changeMealPlan",
      payload: {
        change: {
          _tag: "SetCoverage",
          requirement: {
            date: "2026-10-05",
            occasion: "dinner-stock",
            personId,
          },
          resolution: {
            _tag: "External",
            description: "Dinner elsewhere",
            rationale: "Adult confirmed.",
          },
        },
        expectedRevision: 3,
        mutationId: "stock-revision-change",
        reason: "Dinner elsewhere instead.",
      },
      planId: firstId,
    });
    expect(replacement, JSON.stringify(replacement)).toMatchObject({
      ok: true,
      value: { revision: 4 },
    });
    const accepted = await dispatchHouseholdCommand({
      ...scope,
      operation: "acceptMealPlanRevision",
      payload: {
        expectedRevision: 4,
        mutationId: "stock-revision-accept",
        reason: "Adult approved revision.",
      },
      planId: firstId,
    });
    expect(accepted, JSON.stringify(accepted)).toMatchObject({
      ok: true,
      value: { _tag: "Approved", revision: 5 },
    });
    expect(
      await dispatchHouseholdCommand({
        ...scope,
        operation: "readPlanningContent",
      })
    ).toMatchObject({
      ok: true,
      value: { preparedPortions: [{ reservations: [], state: "available" }] },
    });
  }, 30_000);
});
