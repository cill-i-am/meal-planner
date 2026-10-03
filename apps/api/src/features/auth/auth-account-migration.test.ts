import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { expect, it } from "vitest";

const migrationsRoot = new URL("../../../auth-migrations/", import.meta.url);
const upgrade = "20261002152939_auth_control_plane";
const migrationSql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, migrationsRoot), "utf-8");

const existingDatabase = () => {
  const database = new DatabaseSync(":memory:");
  for (const name of readdirSync(migrationsRoot).toSorted()) {
    if (name === upgrade) {
      break;
    }
    database.exec(migrationSql(name));
  }
  database.exec(`
    INSERT INTO user (id, name, email) VALUES ('account-owner', 'Test', 'test@example.invalid');
    INSERT INTO account (id, issuer, account_id, provider_id, user_id, password, created_at, updated_at)
      VALUES ('credential-account', 'local:credential', 'account-owner', 'credential', 'account-owner', 'synthetic-password-hash', 1, 2);
    INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
      VALUES ('existing-session', 9999999999999, 'synthetic-session-token', 1, 2, 'account-owner');
  `);
  return database;
};

it("upgrades existing auth accounts without losing credentials or sessions", () => {
  const database = existingDatabase();
  try {
    database.exec(migrationSql(upgrade));
    expect(database.prepare("SELECT * FROM account").get()).toMatchObject({
      account_id: "account-owner",
      id: "credential-account",
      password: "synthetic-password-hash",
      provider_id: "credential",
      user_id: "account-owner",
    });
    expect(database.prepare("SELECT id FROM session").get()).toMatchObject({
      id: "existing-session",
    });
    expect(() =>
      database.exec(`
      INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at)
        VALUES ('duplicate', 'account-owner', 'credential', 'account-owner', 3, 3);
    `)
    ).toThrow(/UNIQUE constraint failed/u);
  } finally {
    database.close();
  }
});

it("rejects conflicting historical account identities without discarding either account", () => {
  const database = existingDatabase();
  try {
    database.exec(`
      INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at)
        VALUES ('conflicting-account', 'different-issuer', 'account-owner', 'credential', 'account-owner', 3, 3);
      BEGIN;
    `);
    expect(() => database.exec(migrationSql(upgrade))).toThrow(
      /UNIQUE constraint failed/u
    );
    database.exec("ROLLBACK");
    expect(
      database.prepare("SELECT count(*) AS total FROM account").get()
    ).toMatchObject({ total: 2 });
    expect(
      database
        .prepare("SELECT issuer FROM account WHERE id = 'credential-account'")
        .get()
    ).toMatchObject({ issuer: "local:credential" });
  } finally {
    database.close();
  }
});
