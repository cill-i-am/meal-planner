import {
  HouseholdPersonDisplayName,
  HouseholdPersonMutationId,
  UserId,
} from "@meal-planner/household-api";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Context, Data, Schema } from "effect";
import type { Effect } from "effect";

import { Family, FamilyName } from "./family.js";
import type { CreateFamily, UpdateFamily } from "./family.js";

export class FamilyFailure extends Data.TaggedError("FamilyFailure")<{
  readonly reason:
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "stale_version"
    | "mutation_collision"
    | "creation_incomplete"
    | "unavailable"
    | "rate_limited";
}> {}
export const StoredFamily = Schema.Struct({
  creationMutationId: HouseholdPersonMutationId,
  creationName: FamilyName,
  creatorDisplayName: HouseholdPersonDisplayName,
  creatorLinked: Schema.Boolean,
  creatorUserId: UserId,
  family: Family,
  role: Schema.String,
});
export type StoredFamily = typeof StoredFamily.Type;
export interface FamilyStoreShape {
  readonly list: (
    actor: UserId
  ) => Effect.Effect<readonly Family[], FamilyFailure>;
  readonly get: (
    actor: UserId,
    id: HouseholdOrganizationId
  ) => Effect.Effect<StoredFamily, FamilyFailure>;
  readonly create: (
    actor: UserId,
    creatorName: string,
    input: CreateFamily
  ) => Effect.Effect<StoredFamily, FamilyFailure>;
  readonly update: (
    actor: UserId,
    id: HouseholdOrganizationId,
    input: UpdateFamily
  ) => Effect.Effect<Family, FamilyFailure>;
  readonly complete: (
    actor: UserId,
    id: HouseholdOrganizationId
  ) => Effect.Effect<Family, FamilyFailure>;
  readonly creatorLinked: (
    id: HouseholdOrganizationId
  ) => Effect.Effect<void, FamilyFailure>;
}
export type FamilyStore = FamilyStoreShape;
export const FamilyStore = Context.Service<FamilyStore>(
  "meal-planner/FamilyStore"
);
