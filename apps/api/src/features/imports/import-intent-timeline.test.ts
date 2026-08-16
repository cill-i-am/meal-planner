import { RecipeImportTimelineEvent } from "@meal-planner/recipe-import-api";
import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ImportIntentHistoryRow,
  projectImportIntentHistoryRow,
} from "./import-intent-timeline.js";

const decodeRow = Schema.decodeUnknownSync(ImportIntentHistoryRow, {
  onExcessProperty: "error",
});
const encodeEvent = Schema.encodeSync(RecipeImportTimelineEvent);
const at = "2026-08-16T16:00:00.000Z";
const canonicalUrl = "https://www.tiktok.com/@cook/video/7520000000000001400";
const redirectedToIntentId = "00000000-0000-4000-8000-000000000401";
const actionId = "f".repeat(64);
const recipeId = "00000000-0000-4000-8000-000000000402";

const common = {
  actionId: null,
  at,
  failureCode: null,
  intentId: "00000000-0000-4000-8000-000000000400",
  intentVersion: 1,
  publicNextAttemptAt: null,
  publicSourceKind: null,
  publicSourceUrl: null,
  publicSpeech: null,
  publicStage: "resolving_source",
  publicStageStartedAt: at,
  publicVisuals: null,
  recipeId: null,
  redirectedToIntentId: null,
} as const;

const project = (eventType: string, input: Record<string, unknown> = {}) =>
  Option.map(
    projectImportIntentHistoryRow(
      decodeRow({ ...common, ...input, eventType })
    ),
    encodeEvent
  );

const keysOf = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(keysOf);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...keysOf(nested),
  ]);
};

describe("recipe import intent timeline projection", () => {
  it.each([
    ["intent_admitted", {}, { at, intentVersion: 1, type: "intent_admitted" }],
    [
      "source_resolved",
      { intentVersion: 2, publicSourceUrl: canonicalUrl },
      { at, canonicalUrl, intentVersion: 2, type: "source_resolved" },
    ],
    [
      "intent_redirected",
      { intentVersion: 2, redirectedToIntentId },
      {
        at,
        intentVersion: 2,
        redirect: {
          intentId: redirectedToIntentId,
          link: `/v1/recipe-import-intents/${redirectedToIntentId}`,
        },
        type: "intent_redirected",
      },
    ],
    [
      "processing_stage_changed",
      {
        intentVersion: 3,
        publicSourceKind: "video",
        publicStage: "acquiring_media",
      },
      {
        at,
        intentVersion: 3,
        processing: {
          sourceKind: "video",
          startedAt: at,
          type: "acquiring_media",
        },
        type: "processing_stage_changed",
      },
    ],
    [
      "processing_stage_changed",
      {
        intentVersion: 4,
        publicSpeech: "processing",
        publicStage: "analyzing_evidence",
        publicVisuals: "not_started",
      },
      {
        at,
        intentVersion: 4,
        processing: {
          speech: "processing",
          startedAt: at,
          type: "analyzing_evidence",
          visuals: "not_started",
        },
        type: "processing_stage_changed",
      },
    ],
    [
      "retrying",
      { intentVersion: 5, publicNextAttemptAt: "2026-08-16T16:01:00.000Z" },
      {
        at,
        intentVersion: 5,
        nextAttemptAt: "2026-08-16T16:01:00.000Z",
        type: "retrying",
      },
    ],
    [
      "recovered",
      { intentVersion: 6 },
      { at, intentVersion: 6, type: "recovered" },
    ],
    [
      "action_available",
      {
        actionId,
        intentVersion: 7,
        publicStage: null,
        publicStageStartedAt: null,
      },
      {
        action: {
          id: actionId,
          link: `/v1/recipe-import-intents/00000000-0000-4000-8000-000000000400/actions/${actionId}`,
          type: "review_recipe",
        },
        at,
        intentVersion: 7,
        type: "action_available",
      },
    ],
    [
      "intent_succeeded",
      {
        intentVersion: 8,
        publicStage: null,
        publicStageStartedAt: null,
        recipeId,
      },
      { at, intentVersion: 8, recipeId, type: "intent_succeeded" },
    ],
    [
      "intent_failed",
      {
        failureCode: "analysis_failed",
        intentVersion: 8,
        publicStage: null,
        publicStageStartedAt: null,
      },
      {
        at,
        code: "analysis_failed",
        intentVersion: 8,
        type: "intent_failed",
      },
    ],
    [
      "intent_cancelled",
      {
        intentVersion: 8,
        publicStage: null,
        publicStageStartedAt: null,
      },
      { at, intentVersion: 8, type: "intent_cancelled" },
    ],
  ] as const)(
    "maps %s without private provenance",
    (eventType, input, expected) => {
      const projected = project(eventType, {
        ...input,
        intentId: "00000000-0000-4000-8000-000000000400",
      });
      expect(Option.getOrThrow(projected)).toEqual(expected);
      const encodedKeys = keysOf(Option.getOrThrow(projected));
      for (const forbidden of [
        "actorCategory",
        "actorIdentityHash",
        "commandDigest",
        "evidence",
        "mutationId",
        "provider",
        "r2Key",
        "rawUrl",
        "transcript",
      ]) {
        expect(encodedKeys).not.toContain(forbidden);
      }
    }
  );

  it("omits the non-public migration snapshot", () => {
    expect(project("migration_snapshot")).toEqual(Option.none());
  });
});
