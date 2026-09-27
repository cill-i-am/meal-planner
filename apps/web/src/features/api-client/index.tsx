import { createContext, use } from "react";

import type { ApiRuntime } from "./runtime.js";

export { apiHttpLayer, browserApiRuntime } from "./runtime.js";
export type { ApiRuntime } from "./runtime.js";
export const ApiRuntimeContext = createContext<ApiRuntime | null>(null);
export const useApiRuntime = () => {
  const runtime = use(ApiRuntimeContext);
  if (runtime === null) {
    throw new Error("An API runtime provider is required.");
  }
  return runtime;
};
