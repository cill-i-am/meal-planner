import m0000 from "./20260819075508_household_domain/migration.sql";
import m0001 from "./20260819135904_household_meal_plans/migration.sql";
import m0002 from "./20260820063759_household_domain/migration.sql";
import m0003 from "./20260820064943_household_domain/migration.sql";

export default {
  migrations: {
    "20260819075508_household_domain": m0000,
    "20260819135904_household_meal_plans": m0001,
    "20260820063759_household_domain": m0002,
    "20260820064943_household_domain": m0003,
  },
};
