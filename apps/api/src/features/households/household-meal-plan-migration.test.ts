import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { MealPlan } from "@meal-planner/household-api";
import { Schema } from "effect";
import { expect, it } from "vitest";

const migrationsRoot = fileURLToPath(
  new URL("../../../household-migrations/", import.meta.url)
);
const migrations = readdirSync(migrationsRoot)
  .filter((name) => /^\d{14}_/u.test(name))
  .toSorted();
const retirementName = "retire_slot_meal_plans";
const retirementIndex = migrations.findIndex((name) =>
  name.endsWith(retirementName)
);

const migrate = (database: DatabaseSync, names: readonly string[]) => {
  for (const name of names) {
    database.exec(
      readFileSync(`${migrationsRoot}/${name}/migration.sql`, "utf-8")
    );
  }
};

const rows = <T>(database: DatabaseSync, query: string): T[] =>
  database.prepare(query).all() as T[];

const oldPlanJson = JSON.stringify({
  _tag: "Approved",
  audit: [],
  decision: {
    actorId: "adult-1",
    decidedAt: "2026-09-01T12:00:00.000Z",
    mutationId: "approve-old",
    outcome: "approved",
    reason: "Previous household decision",
  },
  draftId: "draft-old-request",
  gaps: [{ reason: "no_eligible_approved_recipe", slotId: "dinner" }],
  meals: [],
  policy: {
    allowedDifficulties: ["easy"],
    allowedTotalTimeBands: ["under_30_minutes"],
    maxRecipeUses: 1,
    preferredCuisines: [],
    version: "policy-1",
  },
  request: {
    requestKey: "old-request",
    slots: [
      {
        date: "2026-09-01",
        mealType: "dinner",
        servings: 2,
        slotId: "dinner",
      },
    ],
  },
  revision: 1,
});
const currentPlanJson = JSON.stringify({
  _tag: "Draft",
  audit: [],
  planId: "draft-current-request",
  proposed: {
    cookEvents: [],
    coverage: [],
    number: 1,
    pins: {
      configVersion: 0,
      content: [],
      contentSnapshots: [],
      people: [],
      preparedSources: [],
      routines: [],
    },
  },
  request: {
    requestKey: "current-request",
    startDate: "2026-10-05",
    weeks: 1,
  },
  revision: 0,
});

it("retires old slot plans and receipts while current plans remain readable", () => {
  expect(retirementIndex).toBeGreaterThan(0);
  const database = new DatabaseSync(":memory:");
  try {
    migrate(database, migrations.slice(0, retirementIndex));
    database
      .prepare("INSERT INTO household_meal_plans VALUES (?, ?, ?, ?)")
      .run("draft-old-request", oldPlanJson, "old-request-digest", 1);
    database
      .prepare(
        "INSERT INTO household_meal_plan_mutation_receipts VALUES (?, ?, ?, ?)"
      )
      .run(
        "draft-old-request",
        "old-mutation-digest",
        "approve-old",
        oldPlanJson
      );
    database
      .prepare("INSERT INTO household_meal_plans VALUES (?, ?, ?, ?)")
      .run("draft-current-request", currentPlanJson, "current-digest", 0);
    database
      .prepare(
        "INSERT INTO household_meal_plan_mutation_receipts VALUES (?, ?, ?, ?)"
      )
      .run(
        "draft-current-request",
        "current-mutation-digest",
        "change-current",
        currentPlanJson
      );
    const before = rows<{ plan_json: string }>(
      database,
      "SELECT plan_json FROM household_meal_plans ORDER BY rowid DESC LIMIT 12"
    );
    expect(() =>
      before.map(({ plan_json }) =>
        Schema.decodeUnknownSync(Schema.fromJsonString(MealPlan))(plan_json)
      )
    ).toThrow();

    migrate(database, migrations.slice(retirementIndex));
    const active = rows<{ draft_id: string; plan_json: string }>(
      database,
      "SELECT draft_id, plan_json FROM household_meal_plans ORDER BY rowid DESC LIMIT 12"
    );
    expect(active).toEqual([
      { draft_id: "draft-current-request", plan_json: currentPlanJson },
    ]);
    expect(
      Schema.decodeUnknownSync(Schema.fromJsonString(MealPlan))(
        active[0]?.plan_json
      ).planId
    ).toBe("draft-current-request");
    expect(
      rows(database, "SELECT * FROM household_meal_plan_retired_plans")
    ).toEqual([
      {
        draft_id: "draft-old-request",
        plan_json: oldPlanJson,
        request_fingerprint_digest: "old-request-digest",
        revision: 1,
      },
    ]);
    expect(
      rows(
        database,
        "SELECT * FROM household_meal_plan_retired_mutation_receipts"
      )
    ).toEqual([
      {
        draft_id: "draft-old-request",
        mutation_fingerprint: "old-mutation-digest",
        mutation_id: "approve-old",
        result_json: oldPlanJson,
      },
    ]);
    expect(
      rows(database, "SELECT * FROM household_meal_plan_mutation_receipts")
    ).toEqual([
      {
        draft_id: "draft-current-request",
        mutation_fingerprint: "current-mutation-digest",
        mutation_id: "change-current",
        result_json: currentPlanJson,
      },
    ]);
  } finally {
    database.close();
  }
});

it("preserves malformed old rows and orphan receipts, and replay does not change the archive", () => {
  expect(retirementIndex).toBeGreaterThan(0);
  const database = new DatabaseSync(":memory:");
  try {
    migrate(database, migrations.slice(0, retirementIndex));
    database
      .prepare("INSERT INTO household_meal_plans VALUES (?, ?, ?, ?)")
      .run("draft-malformed", "{broken", "malformed-digest", 7);
    database
      .prepare(
        "INSERT INTO household_meal_plan_mutation_receipts VALUES (?, ?, ?, ?)"
      )
      .run("draft-orphan", "orphan-digest", "orphan-change", "{receipt");
    const retirementSql = readFileSync(
      `${migrationsRoot}/${migrations[retirementIndex]}/migration.sql`,
      "utf-8"
    );
    const retirementDataSql = retirementSql.slice(
      retirementSql.indexOf("INSERT OR IGNORE")
    );
    database.exec(retirementSql);
    const first = {
      plans: rows(database, "SELECT * FROM household_meal_plan_retired_plans"),
      receipts: rows(
        database,
        "SELECT * FROM household_meal_plan_retired_mutation_receipts"
      ),
    };
    expect(first).toEqual({
      plans: [
        {
          draft_id: "draft-malformed",
          plan_json: "{broken",
          request_fingerprint_digest: "malformed-digest",
          revision: 7,
        },
      ],
      receipts: [
        {
          draft_id: "draft-orphan",
          mutation_fingerprint: "orphan-digest",
          mutation_id: "orphan-change",
          result_json: "{receipt",
        },
      ],
    });
    database.exec(retirementDataSql);
    expect({
      plans: rows(database, "SELECT * FROM household_meal_plan_retired_plans"),
      receipts: rows(
        database,
        "SELECT * FROM household_meal_plan_retired_mutation_receipts"
      ),
    }).toEqual(first);
    expect(rows(database, "SELECT * FROM household_meal_plans")).toEqual([]);
    expect(
      rows(database, "SELECT * FROM household_meal_plan_mutation_receipts")
    ).toEqual([]);
  } finally {
    database.close();
  }
});

it("rolls back the retirement if a later delete fails", () => {
  expect(retirementIndex).toBeGreaterThan(0);
  const database = new DatabaseSync(":memory:");
  try {
    migrate(database, migrations.slice(0, retirementIndex));
    database
      .prepare("INSERT INTO household_meal_plans VALUES (?, ?, ?, ?)")
      .run("draft-old-request", oldPlanJson, "old-request-digest", 1);
    database
      .prepare(
        "INSERT INTO household_meal_plan_mutation_receipts VALUES (?, ?, ?, ?)"
      )
      .run(
        "draft-old-request",
        "old-mutation-digest",
        "approve-old",
        oldPlanJson
      );
    const retirementSql = readFileSync(
      `${migrationsRoot}/${migrations[retirementIndex]}/migration.sql`,
      "utf-8"
    );
    database.exec("BEGIN");
    database.exec(`CREATE TRIGGER block_plan_retirement BEFORE DELETE ON household_meal_plans
      BEGIN SELECT RAISE(ABORT, 'blocked delete'); END`);
    expect(() => database.exec(retirementSql)).toThrow("blocked delete");
    database.exec("ROLLBACK");
    expect(rows(database, "SELECT draft_id FROM household_meal_plans")).toEqual(
      [{ draft_id: "draft-old-request" }]
    );
    expect(
      rows(
        database,
        "SELECT mutation_id FROM household_meal_plan_mutation_receipts"
      )
    ).toEqual([{ mutation_id: "approve-old" }]);
    expect(
      rows(
        database,
        "SELECT name FROM sqlite_master WHERE name = 'household_meal_plan_retired_plans'"
      )
    ).toEqual([]);
    database.exec(retirementSql);
    expect(
      rows(database, "SELECT draft_id FROM household_meal_plan_retired_plans")
    ).toEqual([{ draft_id: "draft-old-request" }]);
  } finally {
    database.close();
  }
});
