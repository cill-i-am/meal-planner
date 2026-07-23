import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import type {
  CreateImportRequest,
  SourceDescriptor,
} from "./import.contracts.js";
import {
  CreateImportRequest as CreateImportRequestSchema,
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { invalidSource } from "./import.errors.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import { makeImportService } from "./import.service.js";
import type { ImportServiceShape } from "./import.service.js";
import { ValidatedVideoUrl } from "./source-identity.js";

const syntheticCanonicalId = (source: SourceDescriptor) => {
  const match = /^https:\/\/synthetic\.invalid\/imports\/(\d{19})$/u.exec(
    source.url
  );
  return match?.[1];
};

const deterministicSyntheticImportId = (canonicalId: string) =>
  Schema.decodeUnknownSync(ImportId)(
    `018f47ad-91aa-7c35-b6fe-${canonicalId.slice(-12)}`
  );

const syntheticRequest = (sourceUrl: string) =>
  Schema.decodeUnknownSync(CreateImportRequestSchema)({
    source: { kind: "tiktok", url: sourceUrl },
  });

/**
 * Ordinary ImportService composition whose identity, availability, and
 * workflow adapters are entirely local and deterministic.
 */
export const makeProviderFreeSyntheticImportService = (input: {
  readonly database: AnyD1Database;
  readonly now: () => string;
  readonly observe?: {
    readonly availabilityValidation?: () => void;
    readonly identityResolution?: () => void;
    readonly workflowReconciliation?: () => void;
  };
}): ImportServiceShape => {
  const repository = makeD1ImportRepository(input.database);
  const makeFor = (request: CreateImportRequest) => {
    const canonicalId = syntheticCanonicalId(request.source);
    return makeImportService({
      availabilityValidator: {
        validate: () =>
          Effect.sync(() => {
            input.observe?.availabilityValidation?.();
            return { _tag: "Available" as const };
          }),
      },
      identityResolver: {
        resolve: (source) => {
          const sourceCanonicalId = syntheticCanonicalId(source);
          if (sourceCanonicalId === undefined) {
            return Effect.fail(invalidSource());
          }
          return Effect.sync(() => {
            input.observe?.identityResolution?.();
            return {
              _tag: "VideoIdentity" as const,
              identity: {
                canonicalId:
                  Schema.decodeUnknownSync(SourceCanonicalId)(
                    sourceCanonicalId
                  ),
                kind: "tiktok" as const,
              },
              videoUrl: Schema.decodeUnknownSync(ValidatedVideoUrl)(source.url),
            };
          });
        },
      },
      newId: () =>
        deterministicSyntheticImportId(canonicalId ?? "0000000000000000000"),
      now: () => Schema.decodeUnknownSync(ImportTimestamp)(input.now()),
      repository,
      workflowStarter: {
        ensureStarted: () =>
          Effect.sync(() => {
            input.observe?.workflowReconciliation?.();
            return "already_active" as const;
          }),
      },
    });
  };
  return {
    create: (request, idempotencyKey) =>
      makeFor(request).create(request, idempotencyKey),
    get: (id) =>
      makeFor(
        syntheticRequest(
          "https://synthetic.invalid/imports/7000000000000000000"
        )
      ).get(id),
  };
};
