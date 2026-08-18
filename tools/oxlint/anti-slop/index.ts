import { eslintCompatPlugin } from "@oxlint/plugins";

import { noConditionalEmptyObjectSpreadRule } from "./no-conditional-empty-object-spread.ts";
import { noRuntimeTypeofRule } from "./no-runtime-typeof.ts";
import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

/** Register the vendored upstream rules enforced by this repository. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-runtime-typeof": noRuntimeTypeofRule,
    "no-unknown-parameters": noUnknownParametersRule,
  },
});

export default antiSlopPlugin;
