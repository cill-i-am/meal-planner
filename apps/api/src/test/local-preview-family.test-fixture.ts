import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CreateFamily,
  FamilyApiClient,
  makeFamilyApiClientLayer,
} from "@meal-planner/families";
import {
  CreateHouseholdPersonPayload,
  HouseholdPeopleApiClient,
  makeHouseholdPeopleApiClientLayer,
} from "@meal-planner/household-api";
import { Effect, Schema } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { startLocalPreview } from "../local/preview-runtime.js";

const SignupResult = Schema.Struct({
  user: Schema.Struct({ id: Schema.String }),
});

/** Provider-free regression for real preview auth and household bindings. */
const run = async () => {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "meal-preview-family-smoke-")
  );
  try {
    const preview = await startLocalPreview({
      accountId: "0".repeat(32),
      apiToken: "synthetic-no-provider-call",
      dataDirectory,
      gatewayId: "default",
      model: "openai/gpt-6-luna",
      port: 4498,
    });
    try {
      const { baseURL } = preview;
      const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
        body: JSON.stringify({
          email: `preview-family-${randomUUID()}@example.test`,
          name: "Preview Creator",
          password: "Test-family-password-29!",
        }),
        headers: {
          "cf-connecting-ip": "192.0.2.10",
          "content-type": "application/json",
          origin: baseURL,
        },
        method: "POST",
      });
      assert.equal(signup.status, 200, "Better Auth signup should succeed");
      const cookie = signup.headers.get("set-cookie")?.split(";", 1)[0];
      assert.ok(cookie, "Better Auth must set a session cookie");
      const { user } = Schema.decodeUnknownSync(SignupResult)(
        await signup.json()
      );
      const headers = {
        cookie,
        origin: baseURL,
        "x-meal-planner-user": user.id,
      };
      const familyLayer = makeFamilyApiClientLayer({
        baseUrl: baseURL,
        headers,
      });
      const familyPayload = Schema.decodeUnknownSync(CreateFamily)({
        mutationId: randomUUID(),
        name: "Preview Family",
      });
      const created = await Effect.runPromise(
        FamilyApiClient.use((api) =>
          api.families.create({ payload: familyPayload })
        ).pipe(
          Effect.provide(familyLayer),
          Effect.provide(FetchHttpClient.layer)
        )
      );
      const repeated = await Effect.runPromise(
        FamilyApiClient.use((api) =>
          api.families.create({ payload: familyPayload })
        ).pipe(
          Effect.provide(familyLayer),
          Effect.provide(FetchHttpClient.layer)
        )
      );
      assert.equal(repeated.id, created.id, "family replay must reuse its ID");

      const peopleLayer = makeHouseholdPeopleApiClientLayer({
        baseUrl: baseURL,
        headers,
      });
      const initial = await Effect.runPromise(
        HouseholdPeopleApiClient.use((api) =>
          api.people.list({
            params: { familyId: created.id },
            query: { includeArchived: "false" },
          })
        ).pipe(
          Effect.provide(peopleLayer),
          Effect.provide(FetchHttpClient.layer)
        )
      );
      assert.equal(initial.people.length, 1, "creator should be linked once");
      const [creator] = initial.people;
      assert.equal(creator?.id, initial.currentPersonId);
      assert.equal(creator?.displayName, "Preview Creator");
      assert.equal(creator?.kind, "adult");
      assert.equal(creator?.lifecycle, "active");

      const childPayload = Schema.decodeUnknownSync(
        CreateHouseholdPersonPayload
      )({
        displayName: "Preview Child",
        kind: "dependant",
        mutationId: randomUUID(),
      });
      const child = await Effect.runPromise(
        HouseholdPeopleApiClient.use((api) =>
          api.people.create({
            params: { familyId: created.id },
            payload: childPayload,
          })
        ).pipe(
          Effect.provide(peopleLayer),
          Effect.provide(FetchHttpClient.layer)
        )
      );
      const replayedChild = await Effect.runPromise(
        HouseholdPeopleApiClient.use((api) =>
          api.people.create({
            params: { familyId: created.id },
            payload: childPayload,
          })
        ).pipe(
          Effect.provide(peopleLayer),
          Effect.provide(FetchHttpClient.layer)
        )
      );
      assert.equal(
        replayedChild.id,
        child.id,
        "person replay must reuse its ID"
      );
      const finalRoster = await Effect.runPromise(
        HouseholdPeopleApiClient.use((api) =>
          api.people.list({
            params: { familyId: created.id },
            query: { includeArchived: "false" },
          })
        ).pipe(
          Effect.provide(peopleLayer),
          Effect.provide(FetchHttpClient.layer)
        )
      );
      assert.equal(
        finalRoster.people.length,
        2,
        "replays must not duplicate people"
      );
      process.stdout.write(
        `${JSON.stringify({ creatorLinked: true, familyReplay: true, peopleCount: 2, personReplay: true })}\n`
      );
    } finally {
      await preview.stop();
    }
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
};

await run();
