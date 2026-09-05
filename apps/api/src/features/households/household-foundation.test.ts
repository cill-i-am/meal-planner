import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ImportIntentExecutionGeneration } from "../imports/import-intent-transition.js";
import { ImportId } from "../imports/import.contracts.js";
import { HouseholdImportWorkflowOutboxPayload } from "./foundation/import-workflow-admission.contract.js";
import { routeAdmittedHouseholdCommand } from "./household-command-router.js";
import {
  HouseholdObjectLocator,
  makeHouseholdObjectLocator,
} from "./household-object-locator.js";
import { HouseholdOrganizationId } from "./household.contract.js";
import {
  HouseholdMemberAdmission,
  HouseholdPeopleCreatorAdmission,
  HouseholdPeopleMemberAdmission,
  HouseholdSystemAdmission,
  requireHouseholdCommandAdmission,
} from "./rpc/command-envelope.js";
import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
} from "./shared-kernel/authority-services.js";
import { makeHouseholdAuthorityTestLayer } from "./shared-kernel/authority-services.live.js";
import { makeImportWorkflowIdentity } from "./shared-kernel/workflow-identity.js";

const authorityLayer = makeHouseholdAuthorityTestLayer({
  identities: ["dispatch-test-1"],
});

const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "better-auth-organization-private-value"
);
const memberAdmission = Schema.decodeUnknownSync(HouseholdMemberAdmission)({
  actor: {
    _tag: "Member",
    actorId: "a".repeat(64),
  },
  organizationId,
});

describe("household foundation contracts", () => {
  it("derives a stable versioned object name without exposing organization provenance", async () => {
    const locator = await Effect.runPromise(
      makeHouseholdObjectLocator().pipe(Effect.provide(authorityLayer))
    );
    const first = await Effect.runPromise(locator.locate(organizationId));
    const replay = await Effect.runPromise(locator.locate(organizationId));

    expect(first).toBe(replay);
    expect(first).toMatch(/^household:v1:[a-f\d]{64}$/u);
    expect(first).not.toContain(organizationId);
  });

  it("accepts only the actor category admitted for a closed command purpose", () => {
    expect(
      Schema.decodeUnknownSync(HouseholdMemberAdmission)(memberAdmission)
    ).toEqual(memberAdmission);

    const systemAdmission = Schema.decodeUnknownSync(HouseholdSystemAdmission)({
      actor: {
        _tag: "System",
        purpose: "import_workflow_dispatch",
      },
      organizationId,
    });
    expect(
      Effect.runSync(
        requireHouseholdCommandAdmission(
          systemAdmission,
          "record_recipe_import_dispatch"
        )
      )
    ).toEqual(systemAdmission);
    expect(() =>
      Effect.runSync(
        requireHouseholdCommandAdmission(systemAdmission, "ensure_household")
      )
    ).toThrow();
    expect(() =>
      Effect.runSync(
        requireHouseholdCommandAdmission(
          Schema.decodeUnknownSync(HouseholdMemberAdmission)(memberAdmission),
          "bootstrap_creator_person"
        )
      )
    ).toThrow();
    const linkageSubject = "b".repeat(64);
    const auditActorId = "c".repeat(64);
    const peopleMember = Schema.decodeUnknownSync(
      HouseholdPeopleMemberAdmission
    )({
      actor: {
        _tag: "PeopleMember",
        actorId: auditActorId,
        linkageSubject,
      },
      organizationId,
    });
    expect(() =>
      Effect.runSync(
        requireHouseholdCommandAdmission(
          peopleMember,
          "bootstrap_creator_person"
        )
      )
    ).toThrow();
    const peopleCreator = Schema.decodeUnknownSync(
      HouseholdPeopleCreatorAdmission,
      { onExcessProperty: "error" }
    )({
      actor: {
        _tag: "PeopleCreator",
        actorId: auditActorId,
        authority: "better_auth_owner",
        linkageSubject,
      },
      organizationId,
    });
    expect(
      Effect.runSync(
        requireHouseholdCommandAdmission(
          peopleCreator,
          "bootstrap_creator_person"
        )
      )
    ).toEqual(peopleCreator);
    expect(() =>
      Schema.decodeUnknownSync(HouseholdPeopleCreatorAdmission, {
        onExcessProperty: "error",
      })({
        ...peopleCreator,
        actor: { ...peopleCreator.actor, userId: "raw-better-auth-user" },
      })
    ).toThrow();
  });

  it.each([
    "bootstrap_creator_person",
    "read_person_profile",
    "mutate_person_profile",
  ] as const)(
    "rejects the wrong command purpose before routing %s",
    async (purpose) => {
      const systemAdmission = Schema.decodeUnknownSync(
        HouseholdSystemAdmission
      )({
        actor: {
          _tag: "System",
          purpose: "import_workflow_dispatch",
        },
        organizationId,
      });
      const calls = {
        getByName: 0,
        invoke: 0,
        locate: 0,
      };

      const routed = routeAdmittedHouseholdCommand({
        admission: systemAdmission,
        getByName: () => {
          calls.getByName += 1;
          return {};
        },
        invoke: () => {
          calls.invoke += 1;
          return Effect.void;
        },
        locate: () => {
          calls.locate += 1;
          return Effect.succeed("household-object-name");
        },
        purpose,
      });

      await expect(Effect.runPromise(routed)).rejects.toBeDefined();
      expect(calls).toEqual({
        getByName: 0,
        invoke: 0,
        locate: 0,
      });
    }
  );

  it("derives one privacy-safe Workflow identity per execution generation", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "019f9a6b-a4ee-7f8f-b5a3-9dc7aa0c65ea"
    );
    const generationOne = Schema.decodeUnknownSync(
      ImportIntentExecutionGeneration
    )(1);
    const generationTwo = Schema.decodeUnknownSync(
      ImportIntentExecutionGeneration
    )(2);
    const derive = (generation: typeof generationOne) =>
      makeImportWorkflowIdentity({
        executionGeneration: generation,
        importId,
      }).pipe(Effect.provide(authorityLayer));

    const first = await Effect.runPromise(derive(generationOne));
    const replay = await Effect.runPromise(derive(generationOne));
    const nextGeneration = await Effect.runPromise(derive(generationTwo));

    expect(first).toBe(replay);
    expect(first).toMatch(/^import-acquisition:v1:[a-f\d]{64}$/u);
    expect(first).not.toContain(importId);
    expect(nextGeneration).not.toBe(first);
  });

  it("keeps the Workflow dispatch payload compact and closed", () => {
    const payload = {
      executionGeneration: 1,
      importId: "019f9a6b-a4ee-7f8f-b5a3-9dc7aa0c65ea",
      workflowIdentity: `import-acquisition:v1:${"b".repeat(64)}`,
    };
    const decoded = Schema.decodeUnknownSync(
      HouseholdImportWorkflowOutboxPayload,
      { onExcessProperty: "error" }
    )(payload);

    expect(JSON.stringify(decoded)).not.toContain(organizationId);
    expect(() =>
      Schema.decodeUnknownSync(HouseholdImportWorkflowOutboxPayload, {
        onExcessProperty: "error",
      })({ ...payload, organizationId })
    ).toThrow();
  });

  it("provides deterministic canonical encoding and digest services", async () => {
    const encoded = await Effect.runPromise(
      Effect.gen(function* canonicalAuthorityFacts() {
        const canonical = yield* HouseholdCanonicalEncoding;
        const digest = yield* HouseholdDigest;
        const value = yield* canonical.encode(
          Object.fromEntries([
            ["z", 1],
            [
              "a",
              Object.fromEntries([
                ["c", 3],
                ["b", 2],
              ]),
            ],
          ])
        );
        return {
          digest: yield* digest.sha256(value),
          value,
        };
      }).pipe(Effect.provide(authorityLayer))
    );

    expect(encoded.value).toBe('{"a":{"b":2,"c":3},"z":1}');
    expect(encoded.digest).toMatch(/^[a-f\d]{64}$/u);
  });

  it("exposes the central locator as an Effect service", async () => {
    const name = await Effect.runPromise(
      Effect.gen(function* locateHousehold() {
        const locator = yield* HouseholdObjectLocator;
        return yield* locator.locate(organizationId);
      }).pipe(
        Effect.provide(HouseholdObjectLocator.layer),
        Effect.provide(authorityLayer)
      )
    );
    expect(name).toMatch(/^household:v1:[a-f\d]{64}$/u);
  });
});
