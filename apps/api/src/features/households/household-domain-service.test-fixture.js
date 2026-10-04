import { makeDurableObjectBridge, makeWorkerBridge } from "alchemy/Cloudflare";
import { withSqlMigrations } from "alchemy/Cloudflare/Bridge";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

import { householdSqlMigrations } from "../../test/household-sql-migrations.test-fixture.js";
import entrypoint from "./household-domain-worker.js";

const meta = {
  entrypoint: withSqlMigrations(entrypoint, householdSqlMigrations),
  stack: { name: "MealPlanner", stage: "test-household-domain" },
};

// Generated-entry equivalent of Alchemy's public Effect Worker bundle.
export default makeWorkerBridge(WorkerEntrypoint, meta);

const DurableObjectBridge = makeDurableObjectBridge(DurableObject, meta);
export class HouseholdObject extends DurableObjectBridge("HouseholdObject") {}
