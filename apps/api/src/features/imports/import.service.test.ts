import { Cause, Effect, Exit, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { manifestObjectKey, mediaObjectKey } from "./import-media.model.js";
import { ImportTraceContext } from "./import-observability.js";
import {
  CreateImportRequest,
  IdempotencyKey,
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import type { ImportView } from "./import.contracts.js";
import { idempotencyConflict, incompatibleDuplicate } from "./import.errors.js";
import type {
  AcceptImportResult,
  ImportRepositoryError,
  ImportRepositoryShape,
  StoredImport,
  StoredImportRequest,
} from "./import.repository.js";
import { CompatibilityFingerprint } from "./import.repository.js";
import { makeImportService } from "./import.service.js";
import type { ImportWorkflowStarterShape } from "./import.workflow.js";
import type {
  SourceAvailability,
  SourceAvailabilityValidatorShape,
} from "./source-availability.js";
import { makeTikTokSourceAvailabilityValidator } from "./source-availability.tiktok.js";
import type { CanonicalSourceIdentityResolverShape } from "./source-identity.js";
import { ValidatedVideoUrl } from "./source-identity.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./source-identity.tiktok.js";

const decodeRequest = Schema.decodeUnknownSync(CreateImportRequest);
const decodeKey = Schema.decodeUnknownSync(IdempotencyKey);
const decodeId = Schema.decodeUnknownSync(ImportId);
const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);
const decodeCompatibilityFingerprint = Schema.decodeUnknownSync(
  CompatibilityFingerprint
);
const decodeVideoUrl = Schema.decodeUnknownSync(ValidatedVideoUrl);
const ingressTrace = Schema.decodeUnknownSync(ImportTraceContext)({
  correlationId: "10000000-0000-4000-8000-000000000007",
});
const laterIngressTrace = Schema.decodeUnknownSync(ImportTraceContext)({
  correlationId: "20000000-0000-4000-8000-000000000007",
});

const now = decodeTimestamp("2026-07-20T10:00:00.000Z");

const makeRepository = () => {
  const audioExtractionRecoveryEligibleIds = new Set<string>();
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
    isAudioExtractionRecoveryEligible: (id) =>
      Effect.succeed(audioExtractionRecoveryEligibleIds.has(id)),
  };

  const markTranscriptionFailed = (id: ImportId) => {
    const replace = (stored: StoredImport): StoredImport => {
      const view = {
        createdAt: stored.view.createdAt,
        evidence: [
          {
            kind: "original_media",
            referenceId: mediaObjectKey(id, stored.acquisitionGeneration),
          },
          {
            kind: "acquisition_manifest",
            referenceId: manifestObjectKey(id, stored.acquisitionGeneration),
          },
        ],
        id: stored.view.id,
        source: stored.view.source,
        status: {
          code: "transcription_failed",
          kind: "failed",
          recovery: "retry_later",
        },
        updatedAt: stored.view.updatedAt,
      } satisfies ImportView;
      return { ...stored, view };
    };
    for (const [key, stored] of imports) {
      if (stored.view.id === id) {
        imports.set(key, replace(stored));
      }
    }
    for (const [key, storedRequest] of requests) {
      if (storedRequest.import.view.id === id) {
        requests.set(key, {
          ...storedRequest,
          import: replace(storedRequest.import),
        });
      }
    }
  };

  const markCompatibilityObsolete = (id: ImportId) => {
    const obsoleteCompatibility = decodeCompatibilityFingerprint(
      "0".repeat(64)
    );
    const replace = (stored: StoredImport): StoredImport => ({
      ...stored,
      compatibilityFingerprint: obsoleteCompatibility,
    });
    for (const [key, stored] of imports) {
      if (stored.view.id === id) {
        imports.set(key, replace(stored));
      }
    }
    for (const [key, storedRequest] of requests) {
      if (storedRequest.import.view.id === id) {
        requests.set(key, {
          ...storedRequest,
          import: replace(storedRequest.import),
        });
      }
    }
  };

  return {
    acceptCalls: () => acceptCalls,
    audioExtractionRecoveryEligibleIds,
    imports,
    markCompatibilityObsolete,
    markTranscriptionFailed,
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
  const traces: ImportTraceContext[] = [];
  const workflow: ImportWorkflowStarterShape = {
    ensureStarted: (importId, trace) =>
      Effect.sync(() => {
        started.push(importId);
        traces.push(trace);
        return "already_active" as const;
      }),
  };
  return { started, traces, workflow };
};

const makeFixture = (outcome?: SourceAvailability) => {
  const repository = makeRepository();
  const identity = makeIdentityResolver();
  const availability = makeAvailability(outcome);
  const workflow = makeWorkflow();
  let nextId = 1;
  const makeService = (trace = ingressTrace) =>
    makeImportService({
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
      trace,
      workflowStarter: workflow.workflow,
    });
  const service = makeService();

  return { availability, identity, makeService, repository, service, workflow };
};

const videoRequest = (canonicalId = "7520000000000000000", user = "cook") =>
  decodeRequest({
    source: {
      kind: "tiktok",
      url: `https://www.tiktok.com/@${user}/video/${canonicalId}`,
    },
  });

const photoHandoffResponse = (canonical: string) =>
  new Response(
    `<!doctype html><script type="application/json" id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(
      {
        __DEFAULT_SCOPE__: {
          "seo.abtest": {
            canonical,
          },
        },
      }
    )}</script>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200,
    }
  );

const itemHandoffResponse = (mediaKind: "ambiguous" | "carousel" | "video") => {
  let media;
  if (mediaKind === "video") {
    media = { video: { duration: 45 } };
  } else if (mediaKind === "carousel") {
    media = { imagePost: { images: [] } };
  } else {
    media = { imagePost: { images: [] }, video: { duration: 45 } };
  }

  return new Response(
    `<!doctype html><script type="application/json" id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(
      {
        __DEFAULT_SCOPE__: {
          "seo.abtest": {
            canonical: "https://www.tiktok.com/",
          },
          "webapp.video-detail": {
            itemInfo: {
              itemStruct: {
                author: {
                  uniqueId: "synthetic_cook",
                },
                id: "7520000000000000001",
                ...media,
              },
            },
            statusCode: 0,
          },
        },
      }
    )}</script>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200,
    }
  );
};

const itemHandoffRequest = decodeRequest({
  source: {
    kind: "tiktok",
    url: "https://vm.tiktok.com/Zsynthetic",
  },
});

const makeItemHandoffFixture = (
  mediaKind: "ambiguous" | "carousel" | "video"
) => {
  const fixture = makeFixture();
  let fetchCalls = 0;
  const identityResolver = makeTikTokCanonicalSourceIdentityResolver(() => {
    fetchCalls += 1;
    return Promise.resolve(
      fetchCalls === 1
        ? new Response(null, {
            headers: { location: "https://www.tiktok.com/t/Zsynthetic" },
            status: 302,
          })
        : itemHandoffResponse(mediaKind)
    );
  });
  const service = makeImportService({
    availabilityValidator: fixture.availability.validator,
    identityResolver,
    newId: () => decodeId("018f47ad-91aa-7c35-b6fe-000000000100"),
    now: () => now,
    repository: fixture.repository.repository,
    trace: ingressTrace,
    workflowStarter: fixture.workflow.workflow,
  });

  return { ...fixture, fetchCalls: () => fetchCalls, service };
};

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
    expect(fixture.workflow.traces).toEqual([ingressTrace]);
    expect(result).not.toHaveProperty("trace");
    expect(result.import).not.toHaveProperty("trace");
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
    expect(fixture.workflow.started).toEqual([
      replay.import.id,
      replay.import.id,
    ]);
  });

  it("rejects an obsolete exact-locator replay without provider or workflow work", async () => {
    const fixture = makeFixture();
    const request = videoRequest();
    const first = await Effect.runPromise(
      fixture.service.create(request, decodeKey("K1"))
    );
    fixture.repository.markCompatibilityObsolete(first.import.id);
    fixture.workflow.started.length = 0;
    const identityCalls = fixture.identity.calls();
    const availabilityCalls = fixture.availability.calls();

    const exit = await Effect.runPromiseExit(
      fixture.service.create(request, decodeKey("K1"))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected incompatible duplicate");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))._tag).toBe(
      "IncompatibleDuplicate"
    );
    expect(fixture.identity.calls()).toBe(identityCalls);
    expect(fixture.availability.calls()).toBe(availabilityCalls);
    expect(fixture.repository.acceptCalls()).toBe(1);
    expect(fixture.workflow.started).toEqual([]);
  });

  it("restarts a URL replay only when its transcription failure is locally audio-extraction eligible", async () => {
    const fixture = makeFixture();
    const request = videoRequest();
    const first = await Effect.runPromise(
      fixture.service.create(request, decodeKey("K1"))
    );
    fixture.repository.markTranscriptionFailed(first.import.id);
    fixture.repository.audioExtractionRecoveryEligibleIds.add(first.import.id);
    fixture.workflow.started.length = 0;
    const identityCalls = fixture.identity.calls();
    const availabilityCalls = fixture.availability.calls();

    const replay = await Effect.runPromise(
      fixture.service.create(request, decodeKey("K1"))
    );

    expect(replay.disposition).toBe("idempotency_replay");
    expect(fixture.identity.calls()).toBe(identityCalls);
    expect(fixture.availability.calls()).toBe(availabilityCalls);
    expect(fixture.workflow.started).toEqual([first.import.id]);
  });

  it("does not restart a URL replay for any other transcription failure", async () => {
    const fixture = makeFixture();
    const request = videoRequest();
    const first = await Effect.runPromise(
      fixture.service.create(request, decodeKey("K1"))
    );
    fixture.repository.markTranscriptionFailed(first.import.id);
    fixture.workflow.started.length = 0;

    const replay = await Effect.runPromise(
      fixture.service.create(request, decodeKey("K1"))
    );

    expect(replay.disposition).toBe("idempotency_replay");
    expect(fixture.workflow.started).toEqual([]);
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
    expect(fixture.workflow.started).toEqual([
      first.import.id,
      first.import.id,
    ]);
    expect(fixture.workflow.traces).toEqual([ingressTrace, ingressTrace]);
  });

  it("reuses the canonical stored trace under a later ingress", async () => {
    const fixture = makeFixture();
    const first = await Effect.runPromise(
      fixture.service.create(videoRequest(), decodeKey("K1"))
    );
    const laterService = fixture.makeService(laterIngressTrace);

    const duplicate = await Effect.runPromise(
      laterService.create(videoRequest(undefined, "another"), decodeKey("K2"))
    );

    expect(duplicate.disposition).toBe("canonical_duplicate");
    expect(duplicate.import.id).toBe(first.import.id);
    expect(fixture.workflow.traces).toEqual([ingressTrace, ingressTrace]);
    expect([...fixture.repository.imports.values()][0]?.trace).toEqual(
      ingressTrace
    );
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

  it("persists an empty-placeholder short-link photo handoff as unsupported without availability or workflow work", async () => {
    const fixture = makeFixture();
    let fetchCalls = 0;
    const identityResolver = makeTikTokCanonicalSourceIdentityResolver(() => {
      fetchCalls += 1;
      return Promise.resolve(
        fetchCalls === 1
          ? new Response(null, {
              headers: { location: "https://www.tiktok.com/t/Zsynthetic" },
              status: 302,
            })
          : photoHandoffResponse(
              "https://www.tiktok.com/@/photo/7520000000000000000"
            )
      );
    });
    const service = makeImportService({
      availabilityValidator: fixture.availability.validator,
      identityResolver,
      newId: () => decodeId("018f47ad-91aa-7c35-b6fe-000000000099"),
      now: () => now,
      repository: fixture.repository.repository,
      trace: ingressTrace,
      workflowStarter: fixture.workflow.workflow,
    });

    const result = await Effect.runPromise(
      service.create(
        decodeRequest({
          source: {
            kind: "tiktok",
            url: "https://vm.tiktok.com/Zsynthetic",
          },
        }),
        decodeKey("K-photo-handoff")
      )
    );

    expect(result.import).toMatchObject({
      source: {
        canonicalId: "7520000000000000000",
        kind: "tiktok",
      },
      status: {
        code: "unsupported_post_type",
        kind: "unsupported",
        recovery: "submit_supported_public_video",
      },
    });
    expect(fetchCalls).toBe(2);
    expect(fixture.availability.calls()).toBe(0);
    expect(fixture.workflow.started).toEqual([]);
  });

  it("advances a typed video item handoff through availability and workflow dispatch", async () => {
    const fixture = makeItemHandoffFixture("video");

    const result = await Effect.runPromise(
      fixture.service.create(
        itemHandoffRequest,
        decodeKey("K-video-item-handoff")
      )
    );

    expect(result.import).toMatchObject({
      source: {
        canonicalId: "7520000000000000001",
        kind: "tiktok",
      },
      status: {
        kind: "queued",
      },
    });
    expect(fixture.fetchCalls()).toBe(2);
    expect(fixture.availability.calls()).toBe(1);
    expect(fixture.workflow.started).toEqual([result.import.id]);
  });

  it("classifies a typed carousel item handoff before availability or workflow dispatch", async () => {
    const fixture = makeItemHandoffFixture("carousel");

    const result = await Effect.runPromise(
      fixture.service.create(
        itemHandoffRequest,
        decodeKey("K-carousel-item-handoff")
      )
    );

    expect(result.import).toMatchObject({
      source: {
        canonicalId: "7520000000000000001",
        kind: "tiktok",
      },
      status: {
        code: "unsupported_post_type",
        kind: "unsupported",
        recovery: "submit_supported_public_video",
      },
    });
    expect(fixture.fetchCalls()).toBe(2);
    expect(fixture.availability.calls()).toBe(0);
    expect(fixture.workflow.started).toEqual([]);
  });

  it("rejects ambiguous item media before persistence or downstream dispatch", async () => {
    const fixture = makeItemHandoffFixture("ambiguous");

    const exit = await Effect.runPromiseExit(
      fixture.service.create(
        itemHandoffRequest,
        decodeKey("K-ambiguous-item-handoff")
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected ambiguous item media to be rejected");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
      _tag: "SourceIdentityUnavailable",
    });
    expect(fixture.fetchCalls()).toBe(2);
    expect(fixture.availability.calls()).toBe(0);
    expect(fixture.repository.acceptCalls()).toBe(0);
    expect(fixture.workflow.started).toEqual([]);
  });

  it("preserves cancellation before persistence", async () => {
    const fixture = makeFixture();
    const service = makeImportService({
      availabilityValidator: fixture.availability.validator,
      identityResolver: { resolve: () => Effect.never },
      newId: () => decodeId("018f47ad-91aa-7c35-b6fe-000000000001"),
      now: () => now,
      repository: fixture.repository.repository,
      trace: ingressTrace,
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

  it("bounds identity resolution and prevents persistence after the deadline", async () => {
    const fixture = makeFixture();
    let providerAborted = false;
    const started = Promise.withResolvers<boolean>();
    const identityResolver = makeTikTokCanonicalSourceIdentityResolver(
      (_input, init) => {
        const pending = Promise.withResolvers<Response>();
        started.resolve(true);
        init?.signal?.addEventListener(
          "abort",
          () => {
            providerAborted = true;
            pending.reject(new DOMException("aborted", "AbortError"));
          },
          { once: true }
        );
        return pending.promise;
      },
      { deadlineMilliseconds: 100 }
    );
    const service = makeImportService({
      availabilityValidator: fixture.availability.validator,
      identityResolver,
      newId: () => decodeId("018f47ad-91aa-7c35-b6fe-000000000001"),
      now: () => now,
      repository: fixture.repository.repository,
      trace: ingressTrace,
      workflowStarter: fixture.workflow.workflow,
    });
    const exit = await Effect.runPromise(
      Effect.gen(function* timeoutIdentity() {
        const fiber = yield* Effect.forkChild(
          service.create(
            decodeRequest({
              source: {
                kind: "tiktok",
                url: "https://vm.tiktok.com/pending",
              },
            }),
            decodeKey("K1")
          )
        );
        yield* Effect.promise(() => started.promise);
        yield* TestClock.adjust(100);
        return yield* Fiber.await(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected identity timeout");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
      _tag: "SourceIdentityUnavailable",
    });
    expect(providerAborted).toBe(true);
    expect(fixture.availability.calls()).toBe(0);
    expect(fixture.repository.acceptCalls()).toBe(0);
    expect(fixture.workflow.started).toEqual([]);
  }, 1000);

  it("times out a pending availability read without awaiting reader cancellation", async () => {
    const fixture = makeFixture();
    let cancelRequested = false;
    const reading = Promise.withResolvers<boolean>();
    const pendingRead = Promise.withResolvers<undefined>();
    const pendingCancel = Promise.withResolvers<undefined>();
    const availabilityValidator = makeTikTokSourceAvailabilityValidator(
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: () => {
                cancelRequested = true;
                return pendingCancel.promise;
              },
              pull: () => {
                reading.resolve(true);
                return pendingRead.promise;
              },
            }),
            { status: 200 }
          )
        ),
      { deadlineMilliseconds: 100 }
    );
    const service = makeImportService({
      availabilityValidator,
      identityResolver: fixture.identity.resolver,
      newId: () => decodeId("018f47ad-91aa-7c35-b6fe-000000000001"),
      now: () => now,
      repository: fixture.repository.repository,
      trace: ingressTrace,
      workflowStarter: fixture.workflow.workflow,
    });
    const exit = await Effect.runPromise(
      Effect.gen(function* timeoutAvailability() {
        const fiber = yield* Effect.forkChild(
          service.create(videoRequest(), decodeKey("K1"))
        );
        yield* Effect.promise(() => reading.promise);
        yield* TestClock.adjust(100);
        return yield* Fiber.await(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected availability timeout");
    }
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
      _tag: "SourceValidationUnavailable",
    });
    expect(cancelRequested).toBe(true);
    expect(fixture.repository.acceptCalls()).toBe(0);
    expect(fixture.workflow.started).toEqual([]);
  }, 1000);
});
