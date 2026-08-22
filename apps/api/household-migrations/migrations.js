import m0000 from "./20260819075508_household_domain/migration.sql";
import m0001 from "./20260819135904_household_meal_plans/migration.sql";
import m0002 from "./20260821231430_household_domain/migration.sql";
import m0003 from "./20260822065001_household_domain/migration.sql";
import m0004 from "./20260822122042_household_domain/migration.sql";

export default {
  migrations: {
    "20260819075508_household_domain": m0000,
    "20260819135904_household_meal_plans": m0001,
    "20260821231430_household_domain": m0002,
    "20260822065001_household_domain": m0003,
    "20260822122042_household_domain": m0004,
  },
};
