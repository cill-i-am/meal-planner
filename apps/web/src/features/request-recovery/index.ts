import { useEffect, useRef, useState } from "react";

/** Keeps one submitted command for explicit retries while its screen is mounted. */
export const usePendingRequest = <T>(scope: string) => {
  const current = useRef<{ scope: string; id: string; request: T } | null>(
    null
  );
  const [pending, setPending] = useState<typeof current.current>();
  useEffect(() => {
    if (current.current?.scope !== scope) {
      current.current = null;
      setPending(undefined);
    }
  }, [scope]);
  return {
    pending: pending?.scope === scope ? pending.request : undefined,
    release: (id: string) => {
      if (current.current?.scope !== scope || current.current.id !== id) {
        return;
      }
      current.current = null;
      setPending(undefined);
    },
    retain: (id: string, request: T): T => {
      if (current.current?.scope === scope) {
        return current.current.request;
      }
      const next = { id, request, scope };
      current.current = next;
      setPending(next);
      return request;
    },
  };
};
