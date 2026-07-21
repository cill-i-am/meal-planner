import { Effect, Exit, Layer, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ImportAuthorizerShape } from "./import.auth.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import {
  ImportId,
  ImportTimestamp,
  MaximumSourceUrlLength,
  SourceCanonicalId,
} from "./import.contracts.js";
import {
  idempotencyConflict,
  importNotFound,
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  incompatibleDuplicate,
  invalidSource,
  sourceIdentityUnavailable,
  sourceValidationUnavailable,
  workflowStartUnavailable,
} from "./import.errors.js";
import { ImportRoutes } from "./import.routes.js";
import { ImportService } from "./import.service.js";
import type { ImportServiceShape } from "./import.service.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "018f47ad-91aa-7c35-b6fe-000000000001"
);
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-07-20T10:00:00.000Z"
);
const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
  "7520000000000000000"
);
const importView = {
  createdAt: timestamp,
  evidence: [],
  id: importId,
  source: { canonicalId, kind: "tiktok" as const },
  status: { kind: "queued" as const },
  updatedAt: timestamp,
};

let authorizer: ImportAuthorizerShape;

beforeAll(async () => {
  authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make("test-import-token"))
  );
});

const makeApp = (service: ImportServiceShape) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      ImportRoutes,
      Layer.succeed(ImportAuthorizer, ImportAuthorizer.of(authorizer)),
      Layer.succeed(ImportService, ImportService.of(service))
    ),
    { disableLogger: true }
  );

const authorizedHeaders = {
  authorization: "Bearer test-import-token",
  "content-type": "application/json",
  "idempotency-key": "K1",
};

describe("import routes", () => {
  const apps: ReturnType<typeof makeApp>[] = [];

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  it("accepts only the configured bearer token", async () => {
    const configured = await Effect.runPromise(
      makeImportAuthorizer(Redacted.make("expected-token"))
    );

    await expect(
      Effect.runPromise(configured.authorize("Bearer expected-token"))
    ).resolves.toBeUndefined();
    const exits = await Promise.all(
      [
        undefined,
        "",
        "expected-token",
        "Basic expected-token",
        "Bearer wrong-token",
        "Bearer expected-token extra",
      ].map((value) => Effect.runPromiseExit(configured.authorize(value)))
    );
    for (const exit of exits) {
      expect(Exit.isFailure(exit)).toBe(true);
    }
  });

  it("fails closed when the configured token is empty", async () => {
    const configured = await Effect.runPromise(
      makeImportAuthorizer(Redacted.make(""))
    );
    const exit = await Effect.runPromiseExit(
      configured.authorize("Bearer any-token")
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("creates and polls a typed import", async () => {
    const service: ImportServiceShape = {
      create: () =>
        Effect.succeed({ disposition: "created", import: importView }),
      get: () => Effect.succeed({ import: importView }),
    };
    const app = makeApp(service);
    apps.push(app);

    const created = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/video/7520000000000000000",
          },
        }),
        headers: authorizedHeaders,
        method: "POST",
      })
    );
    const polled = await app.handler(
      new Request(`https://meal-planner.test/imports/${importId}`, {
        headers: { authorization: "Bearer test-import-token" },
      })
    );

    expect(created.status).toBe(202);
    await expect(created.json()).resolves.toEqual({
      disposition: "created",
      import: {
        ...importView,
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:00:00.000Z",
      },
    });
    expect(polled.status).toBe(200);
    await expect(polled.json()).resolves.toMatchObject({
      import: { id: importId, status: { kind: "queued" } },
    });
  });

  it("returns 422 with a pollable terminal import", async () => {
    const service: ImportServiceShape = {
      create: () =>
        Effect.succeed({
          disposition: "created",
          import: {
            ...importView,
            status: {
              code: "private_or_unavailable",
              kind: "failed",
              recovery: "check_source_visibility",
            },
          },
        }),
      get: () => Effect.succeed({ import: importView }),
    };
    const app = makeApp(service);
    apps.push(app);
    const response = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/video/7520000000000000000",
          },
        }),
        headers: authorizedHeaders,
        method: "POST",
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      import: { id: importId, status: { kind: "failed" } },
    });
  });

  it.each([
    [{ kind: "queued" }, 202],
    [{ kind: "acquiring" }, 202],
    [
      {
        code: "acquisition_temporarily_unavailable",
        kind: "failed",
        recovery: "retry_later",
      },
      422,
    ],
  ] as const)(
    "maps public lifecycle status %# to HTTP %i",
    async (status, expected) => {
      const service: ImportServiceShape = {
        create: () =>
          Effect.succeed({
            disposition: "idempotency_replay",
            import: { ...importView, status },
          }),
        get: () => Effect.succeed({ import: importView }),
      };
      const app = makeApp(service);
      apps.push(app);
      const response = await app.handler(
        new Request("https://meal-planner.test/imports", {
          body: JSON.stringify({
            source: {
              kind: "tiktok",
              url: "https://www.tiktok.com/@cook/video/7520000000000000000",
            },
          }),
          headers: authorizedHeaders,
          method: "POST",
        })
      );

      expect(response.status).toBe(expected);
    }
  );

  it("returns 200 only after acquisition has exact durable evidence", async () => {
    const evidence = [
      {
        kind: "original_media" as const,
        referenceId: `imports/${importId}/acquisition/v1/generations/1/original.mp4`,
      },
      {
        kind: "acquisition_manifest" as const,
        referenceId: `imports/${importId}/acquisition/v1/generations/1/manifest.json`,
      },
    ] as const;
    const acquired = {
      ...importView,
      evidence,
      status: { kind: "acquired" as const },
    };
    const service: ImportServiceShape = {
      create: () =>
        Effect.succeed({ disposition: "idempotency_replay", import: acquired }),
      get: () => Effect.succeed({ import: acquired }),
    };
    const app = makeApp(service);
    apps.push(app);
    const response = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/video/7520000000000000000",
          },
        }),
        headers: authorizedHeaders,
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      import: { evidence, status: { kind: "acquired" } },
    });
  });

  it("publishes exact transcript evidence as a completed import", async () => {
    const evidence = [
      {
        kind: "original_media" as const,
        referenceId: `imports/${importId}/acquisition/v1/generations/1/original.mp4`,
      },
      {
        kind: "acquisition_manifest" as const,
        referenceId: `imports/${importId}/acquisition/v1/generations/1/manifest.json`,
      },
      {
        kind: "speech_transcript" as const,
        referenceId: `imports/${importId}/transcription/v1/generations/1/transcript.json`,
      },
    ] as const;
    const transcribed = {
      ...importView,
      evidence,
      status: { kind: "transcribed" as const },
    };
    const service: ImportServiceShape = {
      create: () =>
        Effect.succeed({
          disposition: "idempotency_replay",
          import: transcribed,
        }),
      get: () => Effect.succeed({ import: transcribed }),
    };
    const app = makeApp(service);
    apps.push(app);
    const created = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/video/7520000000000000000",
          },
        }),
        headers: authorizedHeaders,
        method: "POST",
      })
    );
    const polled = await app.handler(
      new Request(`https://meal-planner.test/imports/${importId}`, {
        headers: { authorization: "Bearer test-import-token" },
      })
    );

    expect(created.status).toBe(200);
    expect(polled.status).toBe(200);
    await expect(polled.json()).resolves.toMatchObject({
      import: { evidence, status: { kind: "transcribed" } },
    });
  });

  it("maps Workflow start loss to a privacy-safe retryable 503", async () => {
    const service: ImportServiceShape = {
      create: () => Effect.fail(workflowStartUnavailable()),
      get: () => Effect.succeed({ import: importView }),
    };
    const app = makeApp(service);
    apps.push(app);
    const response = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@provider-secret/video/7520000000000000000",
          },
        }),
        headers: authorizedHeaders,
        method: "POST",
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "workflow_start_unavailable",
        message: "Import processing is temporarily unavailable.",
      },
    });
  });

  it("authenticates before parsing input or invoking the service", async () => {
    let calls = 0;
    const service: ImportServiceShape = {
      create: () => {
        calls += 1;
        return Effect.succeed({ disposition: "created", import: importView });
      },
      get: () => {
        calls += 1;
        return Effect.succeed({ import: importView });
      },
    };
    const app = makeApp(service);
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: "not-json",
        headers: {
          authorization: "Bearer wrong-provider-secret",
          "content-type": "application/json",
          "idempotency-key": "K1",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="meal-planner-imports"'
    );
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
      },
    });
    expect(calls).toBe(0);
  });

  it("rejects an oversized source URL before invoking the service", async () => {
    let calls = 0;
    const service: ImportServiceShape = {
      create: () => {
        calls += 1;
        return Effect.succeed({ disposition: "created", import: importView });
      },
      get: () => Effect.succeed({ import: importView }),
    };
    const app = makeApp(service);
    apps.push(app);
    const response = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: `https://www.tiktok.com/${"x".repeat(MaximumSourceUrlLength)}`,
          },
        }),
        headers: authorizedHeaders,
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "The import request is invalid.",
      },
    });
    expect(calls).toBe(0);
  });

  it("publishes the constant source identity unavailable contract", async () => {
    const service: ImportServiceShape = {
      create: () => Effect.fail(sourceIdentityUnavailable()),
      get: () => Effect.succeed({ import: importView }),
    };
    const app = makeApp(service);
    apps.push(app);
    const response = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: JSON.stringify({
          source: {
            kind: "tiktok",
            url: "https://vm.tiktok.com/provider-secret-fragment",
          },
        }),
        headers: authorizedHeaders,
        method: "POST",
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "source_resolution_unavailable",
        message: "Source resolution is temporarily unavailable.",
      },
    });
  });

  it("uses constant safe errors without secrets, URLs, or causes", async () => {
    const secret = "provider-secret-fragment";
    const submittedUrl = `https://www.tiktok.com/@${secret}/video/7520000000000000000`;
    const errors = [
      invalidSource(),
      idempotencyConflict(),
      incompatibleDuplicate(),
      sourceIdentityUnavailable(),
      sourceValidationUnavailable(),
      importPersistenceUnavailable(),
      importPersistenceCorrupt(),
    ] as const;
    const expectedStatuses = [400, 409, 409, 503, 503, 503, 500];
    await Promise.all(
      errors.map(async (error, index) => {
        const service: ImportServiceShape = {
          create: () => Effect.fail(error),
          get: () => Effect.succeed({ import: importView }),
        };
        const app = makeApp(service);
        apps.push(app);
        const response = await app.handler(
          new Request("https://meal-planner.test/imports", {
            body: JSON.stringify({
              source: { kind: "tiktok", url: submittedUrl },
            }),
            headers: {
              ...authorizedHeaders,
            },
            method: "POST",
          })
        );
        const body = JSON.stringify(await response.json());

        expect(response.status).toBe(expectedStatuses[index]);
        expect(body).not.toContain(secret);
        expect(body).not.toContain(submittedUrl);
        expect(body).not.toContain("cause");
      })
    );

    const notFoundService: ImportServiceShape = {
      create: () =>
        Effect.succeed({ disposition: "created", import: importView }),
      get: () => Effect.fail(importNotFound(importId)),
    };
    const notFoundApp = makeApp(notFoundService);
    apps.push(notFoundApp);
    const notFoundResponse = await notFoundApp.handler(
      new Request(`https://meal-planner.test/imports/${importId}`, {
        headers: { authorization: "Bearer test-import-token" },
      })
    );
    const notFoundBody = JSON.stringify(await notFoundResponse.json());

    expect(notFoundResponse.status).toBe(404);
    expect(notFoundBody).not.toContain(secret);
    expect(notFoundBody).not.toContain(submittedUrl);
    expect(notFoundBody).not.toContain("cause");
  });

  it("rejects malformed bodies, keys, and ids with the same safe contract", async () => {
    const service: ImportServiceShape = {
      create: () =>
        Effect.succeed({ disposition: "created", import: importView }),
      get: () => Effect.succeed({ import: importView }),
    };
    const app = makeApp(service);
    apps.push(app);
    const badBody = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: "not-json",
        headers: authorizedHeaders,
        method: "POST",
      })
    );
    const badKey = await app.handler(
      new Request("https://meal-planner.test/imports", {
        body: JSON.stringify({ source: { kind: "tiktok", url: "x" } }),
        headers: { ...authorizedHeaders, "idempotency-key": "" },
        method: "POST",
      })
    );
    const badId = await app.handler(
      new Request("https://meal-planner.test/imports/not-a-uuid", {
        headers: { authorization: "Bearer test-import-token" },
      })
    );

    await Promise.all(
      [badBody, badKey, badId].map(async (response) => {
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          error: {
            code: "invalid_request",
            message: "The import request is invalid.",
          },
        });
      })
    );
  });
});
