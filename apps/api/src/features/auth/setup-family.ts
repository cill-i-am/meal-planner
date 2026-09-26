import {
  BootstrapHouseholdCreatorPayload,
  CreatedSetupFamily,
  HouseholdOrganizationId,
  initialSetupProgress,
  SetupProgress,
  SetupProgressVersion,
  SetupFamilyApi,
  SetupFamilyConflict,
  SetupFamilyForbidden,
  SetupFamilyInvalidRequest,
  SetupFamilyRateLimited,
  SetupFamilySchemaErrors,
  SetupFamilyUnauthorized,
  SetupFamilyUnavailable,
  UserId,
} from "@meal-planner/household-api";
import type { CreateSetupFamilyRequest } from "@meal-planner/household-api";
import { Data, Effect, Layer, Schema } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/unstable/httpapi";

import { JsonHttpPlatformServices } from "../../infrastructure/json-http-platform.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import {
  deriveHouseholdPeopleAuditActorId,
  deriveHouseholdPersonLinkageSubject,
} from "../households/people/household-people.identity.js";
import { makeHouseholdPeopleCreatorAdmission } from "../households/rpc/command-envelope.js";
import type { MealPlannerAuthService } from "./auth.alchemy.js";

type FamilyAuthApi = Pick<
  MealPlannerAuthService["api"],
  | "createOrganization"
  | "getActiveMember"
  | "getSession"
  | "listOrganizations"
  | "saveSetupProgress"
  | "setActiveOrganization"
>;

export class SetupFamilyFailure extends Data.TaggedError("SetupFamilyFailure")<{
  readonly reason:
    | "unauthorized"
    | "forbidden"
    | "conflict"
    | "rate-limited"
    | "unavailable";
}> {}

const failure = (reason: SetupFamilyFailure["reason"]) =>
  new SetupFamilyFailure({ reason });
const parseProgress = Schema.decodeUnknownEffect(SetupProgress);
const parseVersion = Schema.decodeUnknownEffect(SetupProgressVersion);
const parseOrganizationId = Schema.decodeUnknownEffect(HouseholdOrganizationId);
const parseUserId = Schema.decodeUnknownEffect(UserId);
const parseCreator = Schema.decodeUnknownEffect(
  BootstrapHouseholdCreatorPayload
);
const parseResult = Schema.decodeUnknownEffect(CreatedSetupFamily);

const authFailure = (error: { readonly statusCode: number }) => {
  if (error.statusCode === 401) {
    return failure("unauthorized");
  }
  if (error.statusCode === 409) {
    return failure("conflict");
  }
  if (error.statusCode === 403) {
    return failure("forbidden");
  }
  if (error.statusCode === 429) {
    return failure("rate-limited");
  }
  return failure("unavailable");
};

/** The account checkpoint retains one command; household facts remain authoritative. */
export const createSetupFamily = (options: {
  readonly auth: FamilyAuthApi;
  readonly domain: Pick<HouseholdDomainWorkerMethods, "bootstrapCreatorPerson">;
  readonly headers: Headers;
  readonly name: typeof CreateSetupFamilyRequest.Type.name;
}) =>
  Effect.gen(function* createFamily() {
    const { auth, domain, headers, name } = options;
    const session = yield* auth
      .getSession({ headers })
      .pipe(Effect.mapError(authFailure));
    if (session === null) {
      return yield* Effect.fail(failure("unauthorized"));
    }
    if (
      headers.get("x-meal-planner-user") !== null &&
      headers.get("x-meal-planner-user") !== session.user.id
    ) {
      return yield* Effect.fail(failure("unauthorized"));
    }
    const userId = yield* parseUserId(session.user.id).pipe(
      Effect.mapError(() => failure("unavailable"))
    );
    const progress = yield* parseProgress(
      session.user.setupProgress ?? initialSetupProgress
    ).pipe(Effect.mapError(() => failure("unavailable")));
    let version = yield* parseVersion(
      session.user.setupProgressVersion ?? 0
    ).pipe(Effect.mapError(() => failure("unavailable")));

    if (progress.checkpoint.stage === "family-review") {
      const completedOrganizationId = progress.checkpoint.organizationId;
      const families = yield* auth
        .listOrganizations({ headers })
        .pipe(Effect.mapError(authFailure));
      const family = families.find(
        (item) => item.id === completedOrganizationId
      );
      if (family === undefined) {
        return yield* Effect.fail(failure("conflict"));
      }
      return yield* parseResult({
        name: family.name,
        organizationId: family.id,
      }).pipe(Effect.mapError(() => failure("unavailable")));
    }

    if (
      progress.checkpoint.stage !== "family-name" &&
      progress.checkpoint.stage !== "family-create"
    ) {
      return yield* Effect.fail(failure("conflict"));
    }
    if (
      progress.checkpoint.stage === "family-create" &&
      progress.checkpoint.name !== name
    ) {
      return yield* Effect.fail(failure("conflict"));
    }
    const command =
      progress.checkpoint.stage === "family-create"
        ? progress.checkpoint
        : {
            creator: {
              displayName: session.user.name,
              mutationId: crypto.randomUUID(),
            },
            name,
            slug: `family-${crypto.randomUUID()}`,
            stage: "family-create" as const,
          };
    const creator = yield* parseCreator(command.creator).pipe(
      Effect.mapError(() => failure("unavailable"))
    );
    if (progress.checkpoint.stage === "family-name") {
      const saved = yield* auth
        .saveSetupProgress({
          body: {
            expectedVersion: version,
            progress: { checkpoint: { ...command, creator }, status: "active" },
          },
          headers,
        })
        .pipe(Effect.mapError(authFailure));
      const { version: savedVersion } = saved;
      version = savedVersion;
    }

    const families = yield* auth
      .listOrganizations({ headers })
      .pipe(Effect.mapError(authFailure));
    let family = families.find((item) => item.slug === command.slug);
    if (family === undefined) {
      family = yield* auth
        .createOrganization({
          body: { name: command.name, slug: command.slug },
          headers,
        })
        .pipe(Effect.mapError(authFailure));
    }
    const organizationId = yield* parseOrganizationId(family.id).pipe(
      Effect.mapError(() => failure("unavailable"))
    );
    yield* auth
      .setActiveOrganization({ body: { organizationId }, headers })
      .pipe(Effect.mapError(authFailure));
    const membership = yield* auth
      .getActiveMember({ headers })
      .pipe(Effect.mapError(authFailure));
    if (
      membership === null ||
      membership.userId !== userId ||
      membership.organizationId !== organizationId ||
      membership.role !== "owner"
    ) {
      return yield* Effect.fail(failure("conflict"));
    }
    const [actorId, linkageSubject] = yield* Effect.all([
      deriveHouseholdPeopleAuditActorId(organizationId, userId),
      deriveHouseholdPersonLinkageSubject(organizationId, userId),
    ]).pipe(Effect.mapError(() => failure("unavailable")));
    const admission = yield* makeHouseholdPeopleCreatorAdmission({
      actorId,
      creatorAuthority: "better_auth_owner",
      linkageSubject,
      organizationId,
    }).pipe(Effect.mapError(() => failure("unavailable")));
    yield* domain
      .bootstrapCreatorPerson({ admission, payload: creator })
      .pipe(Effect.mapError(() => failure("unavailable")));
    yield* auth
      .saveSetupProgress({
        body: {
          expectedVersion: version,
          progress: {
            checkpoint: { organizationId, stage: "family-review" },
            status: "active",
          },
          sourceCommandId: creator.mutationId,
        },
        headers,
      })
      .pipe(Effect.mapError(authFailure));
    return yield* parseResult({ name: command.name, organizationId }).pipe(
      Effect.mapError(() => failure("unavailable"))
    );
  });

const familyProblem = (error: SetupFamilyFailure) => {
  switch (error.reason) {
    case "unauthorized": {
      return SetupFamilyUnauthorized.make({
        message: "Sign in to create your family.",
      });
    }
    case "forbidden": {
      return SetupFamilyForbidden.make({
        message: "This account cannot create or open this family.",
      });
    }
    case "conflict": {
      return SetupFamilyConflict.make({
        message: "Another family request is already saved. Reload to continue.",
      });
    }
    case "rate-limited": {
      return SetupFamilyRateLimited.make({
        message: "Too many attempts. Wait a moment and try again.",
      });
    }
    case "unavailable": {
      return SetupFamilyUnavailable.make({
        message: "Your family couldn’t be created right now. Try again.",
      });
    }
    default: {
      const unexpected: never = error.reason;
      return unexpected;
    }
  }
};

export const setupFamilyHttpApiLayer = (options: {
  readonly auth: FamilyAuthApi;
  readonly domain: Pick<HouseholdDomainWorkerMethods, "bootstrapCreatorPerson">;
}) => {
  const handlers = HttpApiBuilder.group(
    SetupFamilyApi,
    "setupFamily",
    (group) =>
      group.handle("create", ({ payload }) =>
        Effect.gen(function* handleFamilyCreation() {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return yield* createSetupFamily({
            ...options,
            headers: new Headers(Object.entries(request.headers)),
            name: payload.name,
          }).pipe(Effect.mapError(familyProblem));
        })
      )
  );
  const schemaErrors = HttpApiMiddleware.layerSchemaErrorTransform(
    SetupFamilySchemaErrors,
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect middleware requires an Effect-valued callback.
    (error) =>
      error.kind === "Body" || error.kind === "ResponseHeaders"
        ? Effect.die(error)
        : Effect.fail(
            SetupFamilyInvalidRequest.make({
              message: "Enter a valid family name.",
            })
          )
  );
  return HttpApiBuilder.layer(SetupFamilyApi).pipe(
    Layer.provide(handlers),
    Layer.provide(schemaErrors),
    Layer.provide(JsonHttpPlatformServices)
  );
};
