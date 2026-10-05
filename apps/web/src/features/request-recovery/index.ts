import { Schema } from "effect";
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

type StoredRequest<T> =
  | { readonly key: string; readonly request: T | null; readonly error: null }
  | { readonly key: string; readonly request: null; readonly error: string };

/** Keeps one exact command in session storage until its outcome is definite. */
export const useSessionPendingRequest = <T>(
  key: string,
  schema: Schema.ConstraintDecoder<T>,
  identity: (request: T) => string
) => {
  const [stored, setStored] = useState<StoredRequest<T>>({
    error: null,
    key: "",
    request: null,
  });
  const read = (): StoredRequest<T> => {
    try {
      const raw = globalThis.sessionStorage.getItem(key);
      return {
        error: null,
        key,
        request:
          raw === null
            ? null
            : Schema.decodeUnknownSync(schema, {
                onExcessProperty: "error",
              })(JSON.parse(raw)),
      };
    } catch {
      return {
        error:
          "A saved request could not be read. Its outcome may still be unknown, so no new change can be sent from this page.",
        key,
        request: null,
      };
    }
  };
  useEffect(() => {
    setStored(read());
  }, [key]);
  const current = stored.key === key ? stored : null;
  return {
    error: current?.error ?? null,
    isBlocked:
      current === null || current.error !== null || current.request !== null,
    isReady: current !== null,
    pending: current?.request ?? null,
    release: (submitted: T) => {
      const latest = read();
      if (
        latest.error !== null ||
        latest.request === null ||
        identity(latest.request) !== identity(submitted)
      ) {
        return;
      }
      try {
        globalThis.sessionStorage.removeItem(key);
        setStored((state) =>
          state.key === key ? { error: null, key, request: null } : state
        );
      } catch {
        setStored((state) =>
          state.key === key
            ? {
                error:
                  "The confirmed request could not be cleared from this browser session.",
                key,
                request: null,
              }
            : state
        );
      }
    },
    retain: (request: T): boolean => {
      const latest = read();
      if (latest.error !== null) {
        setStored(latest);
        return false;
      }
      if (latest.request !== null) {
        setStored(latest);
        return false;
      }
      try {
        globalThis.sessionStorage.setItem(key, JSON.stringify(request));
        setStored({ error: null, key, request });
        return true;
      } catch {
        setStored({
          error:
            "This browser could not retain the request. The change was not sent.",
          key,
          request: null,
        });
        return false;
      }
    },
  };
};
