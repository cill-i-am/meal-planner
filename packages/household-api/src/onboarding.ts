import { Schema } from "effect";

import {
  BootstrapHouseholdCreatorPayload,
  HouseholdAuthResourceId,
} from "./people.js";

export const FamilyName = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Enter a family name." }).abort(),
  Schema.isMaxLength(80, { message: "Use 80 characters or fewer." })
);

export const SetupCheckpoint = Schema.Union([
  Schema.Struct({
    name: Schema.String.check(Schema.isMaxLength(80)),
    stage: Schema.Literal("family-name"),
  }),
  Schema.Struct({
    creator: BootstrapHouseholdCreatorPayload,
    name: FamilyName,
    slug: Schema.String.check(Schema.isPattern(/^family-[a-f0-9-]{36}$/u)),
    stage: Schema.Literal("family-create"),
  }),
  Schema.Struct({
    organizationId: HouseholdAuthResourceId,
    stage: Schema.Literal("family-review"),
  }),
  Schema.Struct({
    organizationId: HouseholdAuthResourceId,
    stage: Schema.Literal("ready"),
  }),
  Schema.Struct({
    organizationId: HouseholdAuthResourceId,
    stage: Schema.Literal("complete"),
  }),
]);
export type SetupCheckpoint = typeof SetupCheckpoint.Type;

/** Account-owned navigation intent, never authority for household access. No secrets. */
export const SetupProgress = Schema.Struct({
  checkpoint: SetupCheckpoint,
  status: Schema.Literals(["active", "paused"]),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type SetupProgress = typeof SetupProgress.Type;

/** Better Auth validates and persists this through the authenticated update-user endpoint. */
export const setupProgressField = {
  required: false as const,
  type: "json" as const,
  validator: { input: Schema.toStandardSchemaV1(SetupProgress) },
};
