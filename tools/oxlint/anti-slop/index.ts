import { eslintCompatPlugin } from "@oxlint/plugins";

import { noRuntimeTypeofRule } from "./no-runtime-typeof.ts";
import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

/** Register the single vendored upstream rule enforced by this repository. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-runtime-typeof": noRuntimeTypeofRule,
    "no-unknown-parameters": noUnknownParametersRule,
  },
});

export default antiSlopPlugin;
