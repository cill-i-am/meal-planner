import { useEffect, useState } from "react";

import { AuthRequestError } from "./auth-errors.js";

export const useAuthRetry = (error: Error | null) => {
  const retryAt = error instanceof AuthRequestError ? error.retryAt : undefined;
  const [retryReady, setRetryReady] = useState(false);
  useEffect(() => {
    setRetryReady(false);
    if (retryAt === undefined) {
      return;
    }
    const timeout = window.setTimeout(
      () => setRetryReady(true),
      Math.max(0, retryAt - Date.now())
    );
    return () => window.clearTimeout(timeout);
  }, [retryAt]);
  const waiting = retryAt !== undefined && !retryReady && retryAt > Date.now();
  return { retryAt, retryReady, waiting };
};
