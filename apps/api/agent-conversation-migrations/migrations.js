import m0000 from "./20260928210000_agent_conversation/migration.sql";
import m0001 from "./20261004110000_setup_confirmation/migration.sql";

export default {
  migrations: {
    "20260928210000_agent_conversation": m0000,
    "20261004110000_setup_confirmation": m0001,
  },
};
