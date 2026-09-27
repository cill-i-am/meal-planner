import type {
  HouseholdOrganizationId,
  UserId,
  HouseholdPersonDisplayName,
  HouseholdPersonMutationId,
} from "@meal-planner/household-api";
import { Context, Effect, Layer } from "effect";

import type { CreateFamily, Family, UpdateFamily } from "./family.js";
import { FamilyFailure, FamilyStore } from "./persistence.js";
import type { StoredFamily } from "./persistence.js";

export { FamilyFailure, FamilyStore, StoredFamily } from "./persistence.js";
export type { FamilyStoreShape } from "./persistence.js";

export interface FamilyActor {
  readonly id: UserId;
  readonly name: HouseholdPersonDisplayName;
}

/** The application asks for a linked creator; adapters own identity and RPC mechanics. */
export interface HouseholdCreator {
  readonly link: (input: {
    readonly familyId: HouseholdOrganizationId;
    readonly userId: UserId;
    readonly displayName: HouseholdPersonDisplayName;
    readonly mutationId: HouseholdPersonMutationId;
  }) => Effect.Effect<void, FamilyFailure>;
}
export const HouseholdCreator = Context.Service<HouseholdCreator>(
  "meal-planner/families/HouseholdCreator"
);

interface FamilyServiceShape {
  readonly list: (
    actor: FamilyActor
  ) => Effect.Effect<readonly Family[], FamilyFailure>;
  readonly get: (
    actor: FamilyActor,
    id: HouseholdOrganizationId
  ) => Effect.Effect<Family, FamilyFailure>;
  readonly create: (
    actor: FamilyActor,
    input: CreateFamily
  ) => Effect.Effect<Family, FamilyFailure>;
  readonly resumeCreation: (
    actor: FamilyActor,
    id: HouseholdOrganizationId
  ) => Effect.Effect<Family, FamilyFailure>;
  readonly update: (
    actor: FamilyActor,
    id: HouseholdOrganizationId,
    input: UpdateFamily
  ) => Effect.Effect<Family, FamilyFailure>;
  readonly complete: (
    actor: FamilyActor,
    id: HouseholdOrganizationId
  ) => Effect.Effect<Family, FamilyFailure>;
}
export class FamilyService extends Context.Service<
  FamilyService,
  FamilyServiceShape
>()("meal-planner/families/FamilyService") {}

export const FamilyServiceLive = Layer.effect(
  FamilyService,
  Effect.gen(function* familyApplication() {
    const store = yield* FamilyStore;
    const creator = yield* HouseholdCreator;
    const ensureCreator = (actor: FamilyActor, stored: StoredFamily) =>
      Effect.gen(function* finishCreatorLink() {
        if (!stored.creatorLinked) {
          if (stored.creatorUserId !== actor.id || stored.role !== "owner") {
            return yield* Effect.fail(
              new FamilyFailure({ reason: "creation_incomplete" })
            );
          }
          yield* creator.link({
            displayName: stored.creatorDisplayName,
            familyId: stored.family.id,
            mutationId: stored.creationMutationId,
            userId: actor.id,
          });
          yield* store.creatorLinked(stored.family.id);
        }
        return stored.family;
      });
    return FamilyService.of({
      complete: (actor, id) => store.complete(actor.id, id),
      create: (actor, input) =>
        store
          .create(actor.id, actor.name, input)
          .pipe(Effect.flatMap((stored) => ensureCreator(actor, stored))),
      get: (actor, id) =>
        store.get(actor.id, id).pipe(Effect.map((stored) => stored.family)),
      list: (actor) => store.list(actor.id),
      resumeCreation: (actor, id) =>
        store
          .get(actor.id, id)
          .pipe(Effect.flatMap((stored) => ensureCreator(actor, stored))),
      update: (actor, id, input) => store.update(actor.id, id, input),
    });
  })
);

export { familySlug, canManageFamily } from "./policy.js";
