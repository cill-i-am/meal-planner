import {
  makeDurableObjectBridge,
  makeWorkerBridge,
} from "@alchemy.run/cloudflare";
import { withSqlMigrations } from "@alchemy.run/cloudflare/Bridge";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

import { householdSqlMigrations } from "../../test/household-sql-migrations.fixture.js";
import entrypoint from "./household-domain-worker.js";

const meta = {
  entrypoint: withSqlMigrations(entrypoint, householdSqlMigrations),
  stack: { name: "MealPlanner", stage: "test-household-domain" },
};

export default makeWorkerBridge(WorkerEntrypoint, meta);

const DurableObjectBridge = makeDurableObjectBridge(DurableObject, meta);
export class HouseholdObject extends DurableObjectBridge("HouseholdObject") {}
