import { CreateFamily, UpdateFamily, Family } from "@meal-planner/families";
import {
  FamilyStore,
  FamilyServiceLive,
} from "@meal-planner/families/application";
import {
  UserId,
  HouseholdPerson,
  HouseholdPeopleUnavailable,
} from "@meal-planner/household-api";
import { applyD1Migrations, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Result, Schema, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { beforeAll, describe, expect, it } from "vitest";

import * as authSchema from "../auth/auth.database-schema.js";
import { user } from "../auth/auth.database-schema.js";
import { makeMealPlannerAuth } from "../auth/auth.js";
import { makeNativeAuthTestService } from "../auth/auth.test-fixture.js";
import { HouseholdCreatorLive } from "../households/membership.js";
import { FamilyStoreLive } from "./family-store.d1.js";
import { familyHttpApiLayer } from "./http.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};
const database = drizzle(testEnv.MealPlannerAuthDatabase);
const layer = FamilyStoreLive(database);
const run = <A, E>(effect: Effect.Effect<A, E, FamilyStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)));
const actor = async () => {
  const id = Schema.decodeUnknownSync(UserId)(crypto.randomUUID());
  await database
    .insert(user)
    .values({ email: `${id}@example.test`, id, name: "Creator" });
  return id;
};
const input = (name: string) =>
  Schema.decodeUnknownSync(CreateFamily)({
    mutationId: crypto.randomUUID(),
    name,
  });

describe("Family resource persistence in D1", () => {
  beforeAll(() =>
    applyD1Migrations(
      testEnv.MealPlannerAuthDatabase,
      testEnv.AUTH_TEST_MIGRATIONS
    )
  );

  it("commits one organization and owner for concurrent identical submissions", async () => {
    const userId = await actor();
    const command = input("The Murphy family");
    const create = FamilyStore.use((store) =>
      store.create(userId, "Creator", command)
    );
    const results = await Promise.all([run(create), run(create)]);
    expect(results[0]?.family.id).toBe(results[1]?.family.id);
    expect(results[0]?.family.setup.status).toBe("in_progress");
    const families = await run(FamilyStore.use((store) => store.list(userId)));
    expect(families).toHaveLength(1);
    expect(families[0]?.slug).toMatch(/^the-murphy-family/u);
  });

  it("distinguishes duplicate names, actor-scoped keys, and changed retry input", async () => {
    const a = await actor();
    const b = await actor();
    const command = input("Same family name");
    const first = await run(FamilyStore.use((s) => s.create(a, "A", command)));
    const second = await run(FamilyStore.use((s) => s.create(b, "B", command)));
    expect(first.family.id).not.toBe(second.family.id);
    expect(first.family.slug).not.toBe(second.family.slug);
    const conflict = await run(
      FamilyStore.use((s) =>
        Effect.result(
          s.create(a, "A", {
            ...command,
            name: Schema.decodeUnknownSync(CreateFamily)({
              ...command,
              name: "Other name",
            }).name,
          })
        )
      )
    );
    expect(Result.isFailure(conflict) && conflict.failure.reason).toBe(
      "mutation_collision"
    );
    const denied = await run(
      FamilyStore.use((s) => Effect.result(s.get(b, first.family.id)))
    );
    expect(Result.isFailure(denied) && denied.failure.reason).toBe("not_found");
  });

  it("detects stale edits, replays a lost rename response, and keeps completed families editable", async () => {
    const owner = await actor();
    const created = await run(
      FamilyStore.use((s) => s.create(owner, "Creator", input("Before")))
    );
    const { id } = created.family;
    const update = Schema.decodeUnknownSync(UpdateFamily)({
      expectedVersion: 1,
      mutationId: crypto.randomUUID(),
      name: "After",
    });
    const saved = await run(
      FamilyStore.use((s) => s.update(owner, id, update))
    );
    expect(saved.name).toBe("After");
    expect(saved.slug).toBe(created.family.slug);
    expect(
      await run(FamilyStore.use((s) => s.update(owner, id, update)))
    ).toEqual(saved);
    const stale = await run(
      FamilyStore.use((s) =>
        Effect.result(
          s.update(owner, id, {
            ...update,
            mutationId: input("unused").mutationId,
          })
        )
      )
    );
    expect(Result.isFailure(stale) && stale.failure.reason).toBe(
      "stale_version"
    );
    const incomplete = await run(
      FamilyStore.use((s) => Effect.result(s.complete(owner, id)))
    );
    expect(Result.isFailure(incomplete) && incomplete.failure.reason).toBe(
      "creation_incomplete"
    );
    await run(FamilyStore.use((s) => s.creatorLinked(id)));
    const complete = await run(FamilyStore.use((s) => s.complete(owner, id)));
    expect(complete.setup.status).toBe("complete");
    expect(await run(FamilyStore.use((s) => s.complete(owner, id)))).toEqual(
      complete
    );
    const updated = await run(
      FamilyStore.use((s) =>
        s.update(
          owner,
          id,
          Schema.decodeUnknownSync(UpdateFamily)({
            expectedVersion: complete.version,
            mutationId: crypto.randomUUID(),
            name: "Still editable",
          })
        )
      )
    );
    expect(updated.setup).toEqual(complete.setup);
    const delayed = await run(
      FamilyStore.use((s) => s.update(owner, id, update))
    );
    expect(delayed).toEqual(updated);
    const collision = await run(
      FamilyStore.use((s) =>
        Effect.result(
          s.update(owner, id, {
            ...update,
            expectedVersion: updated.version,
            name: "Reused key",
          })
        )
      )
    );
    expect(Result.isFailure(collision) && collision.failure.reason).toBe(
      "mutation_collision"
    );
  });
});

it("enforces the native auth boundary and retries a partial creator link through the family HTTP API", async () => {
  const auth = makeMealPlannerAuth({
    baseURL: "https://meal-planner.test",
    database,
    outputFence: (_input, canonical) => canonical(),
    schema: authSchema,
    secret: "local-worker-test-secret-at-least-32-characters",
  });
  const signup = await auth.fetch(
    new Request("https://meal-planner.test/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: `${crypto.randomUUID()}@example.test`,
        name: "Creator",
        password: "local-test-password-only",
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://meal-planner.test",
      },
      method: "POST",
    })
  );
  const cookie = signup.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Expected session cookie");
  }
  const createdUser = Schema.decodeUnknownSync(
    Schema.Struct({ user: Schema.Struct({ id: UserId }) })
  )(await signup.json()).user.id;
  const linked = Schema.decodeUnknownSync(HouseholdPerson)({
    associationState: "linked",
    associationVersion: 1,
    createdAtEpochMs: 1,
    displayName: "Creator",
    id: "person_00000000-0000-4000-8000-000000000001",
    isCurrentAdult: true,
    kind: "adult",
    lifecycle: "active",
    updatedAtEpochMs: 1,
    version: 1,
  });
  const calls: string[] = [];
  const services = FamilyServiceLive.pipe(
    Layer.provide(
      HouseholdCreatorLive({
        bootstrapCreatorPerson: ({ payload }) => {
          calls.push(payload.mutationId);
          return calls.length === 1
            ? Effect.fail(HouseholdPeopleUnavailable.make({}))
            : Effect.succeed(linked);
        },
      })
    ),
    Layer.provide(layer)
  );
  const app = HttpRouter.toWebHandler(
    familyHttpApiLayer(makeNativeAuthTestService(auth)).pipe(
      Layer.provide(services),
      HttpRouter.provideRequest(services)
    ),
    { disableLogger: true }
  );
  const command = input("HTTP family");
  const request = (
    path: string,
    method: string,
    body?: object,
    overrides: Record<string, string> = {}
  ) => {
    const init: RequestInit = {
      headers: {
        "cf-connecting-ip": "192.0.2.32",
        "content-type": "application/json",
        cookie,
        origin: "https://meal-planner.test",
        ...overrides,
      },
      method,
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    return app.handler(new Request(`https://meal-planner.test${path}`, init));
  };
  try {
    const response1 = await request("/v1/families", "POST", command, {
      cookie: "",
    });
    expect(response1.status).toBe(401);
    const response2 = await request("/v1/families", "POST", command, {
      origin: "https://other.test",
    });
    expect(response2.status).toBe(403);
    const response3 = await request("/v1/families", "POST", command, {
      "x-meal-planner-user": "other-user",
    });
    expect(response3.status).toBe(401);
    const invalid = await request("/v1/families", "POST", {
      ...command,
      name: "",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ _tag: "FamilyInvalidInput" });
    const response4 = await request("/v1/families", "POST", command);
    expect(response4.status).toBe(503);
    const first = await run(FamilyStore.use((s) => s.list(createdUser)));
    expect(first).toHaveLength(1);
    const [savedFamily] = first;
    if (!savedFamily) {
      throw new Error("Expected saved family");
    }
    const response5 = await request(`/v1/families/${savedFamily.id}`, "GET");
    expect(response5.status).toBe(200);
    // Reads do not perform household writes.
    expect(calls).toHaveLength(1);

    const response = await request(
      `/v1/families/${savedFamily.id}/resume-creation`,
      "POST"
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const family = Schema.decodeUnknownSync(Family)(await response.json());
    expect(calls).toEqual([command.mutationId, command.mutationId]);
    const replay = await request("/v1/families", "POST", command);
    expect(await replay.json()).toEqual(family);
    expect(calls).toHaveLength(2);
    const response6 = await request(
      `/v1/families/${family.id}/complete-setup`,
      "POST"
    );
    expect(response6.status).toBe(200);
    const completed = await request(`/v1/families/${family.id}`, "GET");
    expect(await completed.json()).toMatchObject({
      setup: { status: "complete" },
    });
    await Promise.all(
      ["create", "update"].map(async (path) => {
        const response7 = await auth.fetch(
          new Request(
            `https://meal-planner.test/api/auth/organization/${path}`,
            {
              body: JSON.stringify({
                name: "Bypass",
                organizationId: family.id,
                slug: "bypass",
              }),
              headers: {
                "content-type": "application/json",
                cookie,
                origin: "https://meal-planner.test",
              },
              method: "POST",
            }
          )
        );
        expect(response7.status).toBe(404);
      })
    );
    // Verify the configured rate boundary using actual repeated reads, rather than assuming its key format.
    let limited: Response | undefined;
    for (let i = 0; i < 65; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- Stop at the first rejected request; each response determines whether to send another.
      const next = await request("/v1/families", "GET", undefined, {
        "cf-connecting-ip": "192.0.2.34",
      });
      if (next.status === 429) {
        limited = next;
        break;
      }
    }
    await database
      .update(authSchema.user)
      .set({ name: "x".repeat(81) })
      .where(eq(authSchema.user.id, createdUser));
    const invalidCreator = await request(
      "/v1/families",
      "POST",
      input("No partial record"),
      { "cf-connecting-ip": "192.0.2.35" }
    );
    expect(invalidCreator.status).toBe(503);
    expect(
      await run(FamilyStore.use((store) => store.list(createdUser)))
    ).toHaveLength(1);
    expect(limited?.status).toBe(429);
    expect(await limited?.json()).toMatchObject({ _tag: "FamilyRateLimited" });
  } finally {
    await app.dispose();
  }
});
