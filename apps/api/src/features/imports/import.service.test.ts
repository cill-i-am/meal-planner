import { Cause, Effect, Exit, Fiber, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CreateImportRequest,
  IdempotencyKey,
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { idempotencyConflict, incompatibleDuplicate } from "./import.errors.js";
import type {
  AcceptImportResult,
  ImportRepositoryError,
  ImportRepositoryShape,
  StoredImport,
  StoredImportRequest,
} from "./import.repository.js";
import { makeImportService } from "./import.service.js";
import type { ImportWorkflowStarterShape } from "./import.workflow.js";
import type {
  CanonicalSourceIdentityResolverShape,
  SourceAvailability,
  SourceAvailabilityValidatorShape,
} from "./source-resolver.js";
import { ValidatedVideoUrl } from "./source-resolver.js";

const decodeRequest = Schema.decodeUnknownSync(CreateImportRequest);
const decodeKey = Schema.decodeUnknownSync(IdempotencyKey);
const decodeId = Schema.decodeUnknownSync(ImportId);
const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeVideoUrl = Schema.decodeUnknownSync(ValidatedVideoUrl);

const now = decodeTimestamp("2026-07-20T10:00:00.000Z");

const makeRepository = () => {
  const imports = new Map<string, StoredImport>();
  const requests = new Map<string, StoredImportRequest>();
  let acceptCalls = 0;

  const repository: ImportRepositoryShape = {
    acceptRequest: (command) =>
      Effect.suspend<AcceptImportResult, ImportRepositoryError, never>(() => {
        acceptCalls += 1;
        const request = requests.get(command.idempotencyKeyHash);
        if (request !== undefined) {
          return request.requestFingerprint === command.requestFingerprint
            ? Effect.succeed({
                disposition: "idempotency_replay" as const,
                import: request.import,
              })
            : Effect.fail(idempotencyConflict());
        }

        const canonicalKey = `${command.candidate.sourceKind}:${command.candidate.canonicalSourceId}`;
        const canonical = imports.get(canonicalKey);
        if (canonical !== undefined) {
          if (
            canonical.compatibilityFingerprint !==
            command.candidate.compatibilityFingerprint
          ) {
            return Effect.fail(incompatibleDuplicate());
          }
          requests.set(command.idempotencyKeyHash, {
            import: canonical,
            requestFingerprint: command.requestFingerprint,
            sourceLocatorHash: command.sourceLocatorHash,
          });
          return Effect.succeed({
            disposition: "canonical_duplicate" as const,
            import: canonical,
          });
        }

        imports.set(canonicalKey, command.candidate);
        requests.set(command.idempotencyKeyHash, {
          import: command.candidate,
          requestFingerprint: command.requestFingerprint,
          sourceLocatorHash: command.sourceLocatorHash,
        });
        return Effect.succeed({
          disposition: "created" as const,
          import: command.candidate,
        });
      }),
    findByCanonicalIdentity: ({ canonicalId, kind }) =>
      Effect.succeed(
        Option.fromNullishOr(imports.get(`${kind}:${canonicalId}`))
      ),
    findById: (id) =>
      Effect.succeed(
        Option.fromNullishOr(
          [...imports.values()].find((stored) => stored.view.id === id)
        )
      ),
    findRequest: (idempotencyKeyHash) =>
      Effect.succeed(Option.fromNullishOr(requests.get(idempotencyKeyHash))),
  };

  return {
    acceptCalls: () => acceptCalls,
    imports,
    repository,
    requests,
  };
};

const makeIdentityResolver = () => {
  let calls = 0;
  const resolver: CanonicalSourceIdentityResolverShape = {
    resolve: (source) => {
      calls += 1;
      const match = /\/(?<kind>video|photo)\/(?<canonicalId>\d+)/u.exec(
        source.url
      );
      const canonicalId = match?.groups?.["canonicalId"];
      const kind = match?.groups?.["kind"];
      if (canonicalId === undefined || kind === undefined) {
        throw new Error("invalid test fixture");
      }
      const identity = {
        canonicalId: decodeCanonicalId(canonicalId),
        kind: "tiktok" as const,
      };
      return Effect.succeed(
        kind === "photo"
          ? ({ _tag: "UnsupportedIdentity", identity } as const)
          : ({
              _tag: "VideoIdentity",
              identity,
              videoUrl: decodeVideoUrl(source.url),
            } as const)
      );
    },
  };

  return { calls: () => calls, resolver };
};

const makeAvailability = (outcome?: SourceAvailability) => {
  const result = outcome ?? { _tag: "Available" as const };
  let calls = 0;
  const validator: SourceAvailabilityValidatorShape = {
    validate: () => {
      calls += 1;
      return Effect.succeed(result);
    },
  };
  return { calls: () => calls, validator };
};

const makeWorkflow = () => {
  const started: string[] = [];
  const workflow: ImportWorkflowStarterShape = {
    start: (importId) =>
      Effect.sync(() => {
        started.push(importId);
      }),
  };
  return { started, workflow };
};

const makeFixture = (outcome?: SourceAvailability) => {
  const repository = makeRepository();
  const identity = makeIdentityResolver();
  const availability = makeAvailability(outcome);
  const workflow = makeWorkflow();
  let nextId = 1;
  const service = makeImportService({
    availabilityValidator: availability.validator,
    identityResolver: identity.resolver,
    newId: () => {
      const id = decodeId(
        `018f47ad-91aa-7c35-b6fe-${String(nextId).padStart(12, "0")}`
      );
      nextId += 1;
      return id;
    },
    now: () => now,
    repository: repository.repository,
    workflowStarter: workflow.workflow,
  });

  return { availability, identity, repository, service, workflow };
};

const videoRequest = (canonicalId = "7520000000000000000", user = "cook") =>
  decodeRequest({
    source: {
      kind: "tiktok",
      url: `https://www.tiktok.com/@${user}/video/${canonicalId}`,
    },
  });

describe("ImportService", () => {
  it("persists one queued import and starts the deferred workflow once", async () => {
    const fixture = makeFixture();

    const result = await Effect.runPromise(
      fixture.service.create(videoRequest(), decodeKey("K1"))
    );

    expect(result.disposition).toBe("created");
    expect(result.import.status).toEqual({ kind: "queued" });
    expect(fixture.repository.imports).toHaveLength(1);
    expect(fixture.workflow.started).toEqual([result.import.id]);
  });

  it("replays the same K1 locator with zero provider calls", async () => {
    const fixture = makeFixture();
    const request = videoRequest();
    await Effect.runPromise(fixture.service.create(request, decodeKey("K1")));
    const identityCalls = fixture.identity.calls();
    const availabilityCalls = fixture.availability.calls();

    const replay = await Effect.runPromise(
      fixture.service.create(request, decodeKey("K1"))
    );

    expect(replay.disposition).toBe("idempotency_replay");
    expect(fixture.identity.calls()).toBe(identityCalls);
    expect(fixture.availability.calls()).toBe(availabilityCalls);
    expect(fixture.workflow.started).toHaveLength(1);
  });

  it("replays a canonically equivalent changed K1 without revalidating availability", async () => {
    const fixture = makeFixture();
    await Effect.runPromise(
      fixture.service.create(videoRequest(undefined, "cook"), decodeKey("K1"))
    );
    const availabilityCalls = fixture.availability.calls();

    const replay = await Effect.runPromise(
      fixture.service.create(
        videoRequest(undefined, "another"),
        decodeKey("K1")
      )
    );

    expect(replay.disposition).toBe("idempotency_replay");
    expect(fixture.identity.calls()).toBe(2);
    expect(fixture.availability.calls()).toBe(availabilityCalls);
    expect(fixture.repository.acceptCalls()).toBe(1);
  });

  it("conflicts a changed K1 identity without availability or an orphan", async () => {
    const fixture = makeFixture();
    await Effect.runPromise(
      fixture.service.create(videoRequest(), decodeKey("K1"))
    );
    const availabilityCalls = fixture.availability.calls();
    const exit = await Effect.runPromiseExit(
      fixture.service.create(
        videoRequest("7530000000000000000"),
        decodeKey("K1")
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected conflict");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))._tag).toBe(
      "IdempotencyConflict"
    );
    expect(fixture.availability.calls()).toBe(availabilityCalls);
    expect(fixture.repository.imports).toHaveLength(1);
  });

  it("attaches K2 to a known compatible canonical import with zero availability calls", async () => {
    const fixture = makeFixture();
    const first = await Effect.runPromise(
      fixture.service.create(videoRequest(), decodeKey("K1"))
    );
    const availabilityCalls = fixture.availability.calls();

    const duplicate = await Effect.runPromise(
      fixture.service.create(
        videoRequest(undefined, "another"),
        decodeKey("K2")
      )
    );

    expect(duplicate.disposition).toBe("canonical_duplicate");
    expect(duplicate.import.id).toBe(first.import.id);
    expect(fixture.availability.calls()).toBe(availabilityCalls);
    expect(fixture.repository.requests).toHaveLength(2);
    expect(fixture.workflow.started).toHaveLength(1);
  });

  it("persists private/unavailable and unsupported states without starting work", async () => {
    const privateFixture = makeFixture({ _tag: "PrivateOrUnavailable" });
    const failed = await Effect.runPromise(
      privateFixture.service.create(videoRequest(), decodeKey("K1"))
    );
    const unsupportedFixture = makeFixture();
    const unsupported = await Effect.runPromise(
      unsupportedFixture.service.create(
        decodeRequest({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/photo/7520000000000000000",
          },
        }),
        decodeKey("K2")
      )
    );

    expect(failed.import.status.kind).toBe("failed");
    expect(unsupported.import.status.kind).toBe("unsupported");
    expect(privateFixture.workflow.started).toEqual([]);
    expect(unsupportedFixture.availability.calls()).toBe(0);
    expect(unsupportedFixture.workflow.started).toEqual([]);
  });

  it("preserves cancellation before persistence", async () => {
    const fixture = makeFixture();
    const service = makeImportService({
      availabilityValidator: fixture.availability.validator,
      identityResolver: { resolve: () => Effect.never },
      newId: () => decodeId("018f47ad-91aa-7c35-b6fe-000000000001"),
      now: () => now,
      repository: fixture.repository.repository,
      workflowStarter: fixture.workflow.workflow,
    });
    const exit = await Effect.runPromise(
      Effect.gen(function* exit() {
        const fiber = yield* Effect.forkChild(
          service.create(videoRequest(), decodeKey("K1"))
        );
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(fixture.repository.acceptCalls()).toBe(0);
  });
});
