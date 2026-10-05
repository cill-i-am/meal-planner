import {
  HouseholdPersonId,
  MealPlanPersonPin,
  MealPlanPersistenceFailure,
} from "@meal-planner/household-api";
import type { HouseholdPeoplePrincipal } from "@meal-planner/household-api";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Schema } from "effect";

import type { PlanningAuthority } from "../meal-planning/planning-kernel.js";
import { makeHouseholdMealContentRepository } from "./meal-content/household-meal-content.repository.js";
import { makeHouseholdPeopleRepository } from "./people/household-people.repository.js";
import { makeHouseholdProfileRepository } from "./profiles/household-profile.repository.js";
import type {
  HouseholdCanonicalEncodingService,
  HouseholdDigestService,
  HouseholdIdentityGeneratorService,
} from "./shared-kernel/authority-services.js";

type Actor = Pick<HouseholdPeoplePrincipal, "actorId" | "linkageSubject">;
const unavailable = () =>
  MealPlanPersistenceFailure.make({ operation: "read" });

export const readHouseholdPlanningAuthority = (
  database: EffectSQLiteDoDatabase,
  actor: Actor,
  services: {
    readonly canonical: HouseholdCanonicalEncodingService;
    readonly digest: HouseholdDigestService;
    readonly identity: HouseholdIdentityGeneratorService;
  }
): Effect.Effect<PlanningAuthority, ReturnType<typeof unavailable>> =>
  Effect.gen(function* readPlanningAuthority() {
    const content = yield* makeHouseholdMealContentRepository(
      database,
      services.digest
    )
      .read(actor)
      .pipe(Effect.mapError(unavailable));
    const roster = yield* makeHouseholdPeopleRepository(database, services)
      .list({ ...actor, includeArchived: false })
      .pipe(Effect.mapError(unavailable));
    const profiles = makeHouseholdProfileRepository(database, services);
    const people = yield* Effect.all(
      roster.roster.people.map((person) =>
        Effect.gen(function* pinPersonProfile() {
          const personId = yield* Schema.decodeUnknownEffect(HouseholdPersonId)(
            person.id
          ).pipe(Effect.mapError(unavailable));
          const profile = yield* profiles
            .get({ actor, personId, version: null })
            .pipe(Effect.mapError(unavailable));
          const confirmed = profile.facts.filter(
            (fact) => fact.standing._tag === "confirmed"
          );
          let safetyState: "has_constraints" | "confirmed_none" | "unknown" =
            "unknown";
          if (confirmed.some((fact) => fact.value._tag === "HardConstraint")) {
            safetyState = "has_constraints";
          } else if (
            confirmed.some(
              (fact) => fact.value._tag === "NoKnownHardConstraints"
            )
          ) {
            safetyState = "confirmed_none";
          }
          return yield* Schema.decodeUnknownEffect(MealPlanPersonPin)({
            personId,
            profileVersion: profile.version,
            safetyState,
          }).pipe(Effect.mapError(unavailable));
        })
      )
    );
    return { content, people };
  });
