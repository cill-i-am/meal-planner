import { Layer } from "effect";
import { createEffectQuery } from "effect-query";
import { createContext, use } from "react";

import type { ApiRuntime } from "./runtime.js";

export { apiHttpLayer, browserApiRuntime } from "./runtime.js";
export type { ApiRuntime } from "./runtime.js";
/** Stateless execution adapter; each operation supplies its own identity and transport. */
export const apiEffectQuery = createEffectQuery(Layer.empty);

export const ApiRuntimeContext = createContext<ApiRuntime | null>(null);
export const useApiRuntime = () => {
  const runtime = use(ApiRuntimeContext);
  if (runtime === null) {
    throw new Error("An API runtime provider is required.");
  }
  return runtime;
};

export {
  transientRetry,
  isTransientHttpFailure,
  queryFailure,
  queryFailureCause,
} from "./request-policy.js";
