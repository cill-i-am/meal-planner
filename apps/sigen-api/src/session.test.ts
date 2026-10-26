/* eslint-disable no-await-in-loop -- Each rotation depends on the persisted credentials from the previous cycle. */
import { Enrollment, Station, StationId, failure } from "@meal-planner/sigen";
import type { TokenBundle } from "@meal-planner/sigen";
import type { SigenClient } from "@meal-planner/sigen/client";
import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { SessionRecord, emptySession, makeSession } from "./session.js";
import { makeVault } from "./vault.js";

const key = Redacted.make("ab".repeat(32));
const stationId = Schema.decodeUnknownSync(StationId)("12345");
const otherStation = Schema.decodeUnknownSync(StationId)("54321");
const enrollment = Redacted.make(
  Schema.decodeUnknownSync(Enrollment)({
    password: "never-persist-this-password",
    stationId,
    username: "fixture@example.invalid",
  })
);
const sample = Schema.decodeUnknownSync(Station)({
  batteryCapacityKwh: 8.1,
  capabilities: {
    acCharger: "unavailable",
    dcCharger: "unavailable",
    gateway: "available",
    solar: "available",
  },
  fetchedAt: 1,
  name: "Fixture station",
  onGrid: true,
  providerStatus: 1,
  solarCapacityKw: 5.7,
  stationId,
  timezone: "Europe/Dublin",
});
const run = <A, E>(program: Effect.Effect<A, E>) =>
  Effect.runPromise(program.pipe(Effect.scoped));

const fixture = () => {
  let record: SessionRecord = emptySession;
  let alarm: number | null = null;
  let count = 0;
  let revoked = false;
  const tokens = (): Redacted.Redacted<TokenBundle> =>
    Redacted.make({
      accessToken: `synthetic-access-${count}`,
      expiresAt: Date.now() + (count + 1) * 3_600_000,
      refreshToken: `synthetic-refresh-${count}`,
    });
  const storage = {
    read: Effect.sync(() => Schema.decodeUnknownSync(SessionRecord)(record)),
    write: (value: SessionRecord, at: number | null) =>
      Effect.sync(() => {
        record = value;
        alarm = at;
      }),
  };
  const client: SigenClient = {
    energyFlow: () => Effect.fail(failure("UnsupportedCapability")),
    login: () => Effect.sync(tokens),
    operatingMode: () =>
      Effect.succeed({
        fetchedAt: 1,
        profileId: -1,
        providerMode: 1,
        stationId,
      }),
    refresh: () =>
      Effect.suspend(() => {
        count += 1;
        return revoked
          ? Effect.fail(failure("AuthenticationRequired"))
          : Effect.succeed(tokens());
      }),
    station: () => Effect.succeed(sample),
  };
  return {
    alarm: () => alarm,
    client,
    count: () => count,
    expire: () => {
      if (record.session.phase === "ready") {
        record = {
          ...record,
          session: { ...record.session, expiresAt: Date.now() - 1 },
        };
      }
    },
    interruptRotation: () => {
      if (record.session.phase === "ready") {
        record = {
          ...record,
          session: { ...record.session, phase: "refreshing" },
        };
      }
    },
    make: () => run(makeSession(storage, key, client)),
    record: () => record,
    revoke: () => {
      revoked = true;
    },
    storage,
  };
};

describe("durable Sigen session", () => {
  it("encrypts tokens, never persists the password, and survives reconstruction", async () => {
    const f = fixture();
    const initial = await f.make();
    await run(initial.enroll(enrollment));
    const persisted = JSON.stringify(f.record());
    expect(persisted).not.toContain("synthetic-access");
    expect(persisted).not.toContain("synthetic-refresh");
    expect(persisted).not.toContain("never-persist-this-password");
    const restored = await f.make();
    expect(await run(restored.station(stationId))).toEqual(sample);
    expect(f.alarm()).toBeGreaterThan(Date.now());
  });
  it("serializes simultaneous expired reads into a single rotation", async () => {
    const f = fixture();
    const session = await f.make();
    await run(session.enroll(enrollment));
    f.expire();
    await run(
      Effect.all(
        [
          session.station(stationId),
          session.station(stationId),
          session.operatingMode(stationId),
        ],
        { concurrency: "unbounded" }
      )
    );
    expect(f.count()).toBe(1);
  });
  it("rotates three times across reconstructed services with an alarm committed each time", async () => {
    const f = fixture();
    const initial = await f.make();
    await run(initial.enroll(enrollment));
    for (let i = 1; i <= 3; i += 1) {
      f.expire();
      const session = await f.make();
      await run(session.onAlarm);
      expect(f.count()).toBe(i);
      expect(f.alarm()).toBeGreaterThan(Date.now());
      expect(await run(session.station(stationId))).toEqual(sample);
    }
    const restored = await f.make();
    const report = await run(restored.report);
    expect(report.renewals).toHaveLength(3);
  });
  it("does not replay a refresh after interrupted rotation", async () => {
    const f = fixture();
    const initial = await f.make();
    await run(initial.enroll(enrollment));
    f.interruptRotation();
    const restored = await f.make();
    await run(restored.onAlarm);
    expect(f.count()).toBe(0);
    expect(f.alarm()).toBeNull();
    expect(await run(restored.health)).toMatchObject({
      state: "reauthentication_required",
    });
  });
  it("clears revoked tokens and requires a new enrollment", async () => {
    const f = fixture();
    const session = await f.make();
    await run(session.enroll(enrollment));
    f.expire();
    f.revoke();
    const result = await run(session.station(stationId).pipe(Effect.result));
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "AuthenticationRequired" },
    });
    expect(f.record().session.phase).toBe("reauthentication_required");
    expect(f.alarm()).toBeNull();
  });
  it.each([false, true])(
    "renews at most once per rejected read, expired=%s",
    async (expired) => {
      const f = fixture();
      let rejected = false;
      const client = {
        ...f.client,
        station: () =>
          rejected
            ? Effect.fail(failure("AuthenticationRequired"))
            : Effect.succeed(sample),
      };
      const session = await run(makeSession(f.storage, key, client));
      await run(session.enroll(enrollment));
      if (expired) {
        f.expire();
      }
      rejected = true;
      expect(
        await run(session.station(stationId).pipe(Effect.result))
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "AuthenticationRequired" },
      });
      expect(f.count()).toBe(1);
      expect(f.record().session.phase).toBe("reauthentication_required");
    }
  );

  it("accepts a valid shorter-lived token when renewing a rejected access token", async () => {
    const f = fixture();
    let rejected = false;
    const nextExpiry = Date.now() + 120_000;
    const client = {
      ...f.client,
      refresh: () =>
        Effect.sync(() => {
          rejected = false;
          return Redacted.make({
            accessToken: "new-access",
            expiresAt: nextExpiry,
            refreshToken: "new-refresh",
          });
        }),
      station: () =>
        rejected
          ? Effect.fail(failure("AuthenticationRequired"))
          : Effect.succeed(sample),
    };
    const session = await run(makeSession(f.storage, key, client));
    await run(session.enroll(enrollment));
    rejected = true;
    expect(await run(session.station(stationId))).toEqual(sample);
    expect(await run(session.health)).toMatchObject({
      accessTokenExpiresAt: nextExpiry,
      state: "connected",
    });
    expect(f.alarm()).toBe(nextExpiry - 60_000);
  });

  it("does not replay a consumed refresh after its rotated-token commit fails", async () => {
    const f = fixture();
    const storage = {
      ...f.storage,
      write: (record: SessionRecord, alarmAt: number | null) =>
        record.session.phase === "ready" && record.successfulRenewals > 0
          ? Effect.fail(failure("StorageUnavailable"))
          : f.storage.write(record, alarmAt),
    };
    const session = await run(makeSession(storage, key, f.client));
    await run(session.enroll(enrollment));
    f.expire();
    expect(await run(session.onAlarm.pipe(Effect.result))).toMatchObject({
      _tag: "Failure",
      failure: { reason: "StorageUnavailable" },
    });
    expect(f.record().session.phase).toBe("refreshing");
    const restored = await f.make();
    await run(restored.onAlarm);
    expect(f.count()).toBe(1);
    expect(f.record().session.phase).toBe("reauthentication_required");
  });

  it("rejects unrelated station IDs before any provider call", async () => {
    const f = fixture();
    const session = await f.make();
    await run(session.enroll(enrollment));
    const result = await run(session.station(otherStation).pipe(Effect.result));
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
    expect(f.count()).toBe(0);
  });
  it("does not rotate on an early alarm and disconnect removes the alarm", async () => {
    const f = fixture();
    const session = await f.make();
    await run(session.enroll(enrollment));
    await run(session.onAlarm);
    expect(f.count()).toBe(0);
    await run(session.disconnect);
    expect(f.alarm()).toBeNull();
    expect(f.record()).toEqual(emptySession);
  });
  it("rejects tampered ciphertext and a different encryption key", async () => {
    const vault = makeVault(key);
    const encrypted = await run(
      vault.encrypt(
        Redacted.make({ kind: "enrollment", value: Redacted.value(enrollment) })
      )
    );
    const damaged = {
      ...encrypted,
      cipher: `${encrypted.cipher.startsWith("A") ? "B" : "A"}${encrypted.cipher.slice(1)}`,
    };
    expect(await run(vault.decrypt(damaged).pipe(Effect.result))).toMatchObject(
      { _tag: "Failure", failure: { reason: "StorageUnavailable" } }
    );
    expect(
      await run(
        makeVault(Redacted.make("cd".repeat(32)))
          .decrypt(encrypted)
          .pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure" });
  });
});
