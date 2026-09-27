import { Option, Schema } from "effect";
import { useMemo, useState, useSyncExternalStore } from "react";

const eventName = "family-request-changed";
const unavailable = Symbol("storage unavailable");
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(eventName, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(eventName, notify);
  };
};

/** Only submitted commands are retained. Each ID has its own slot across tabs. */
export const useRetainedRequest = <T>(
  scope: string,
  schema: Schema.ConstraintDecoder<T>
) => {
  const prefix = `meal-planner:request:${scope}:`;
  const [writeError, setWriteError] = useState<string>();
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const keys = Object.keys(localStorage)
          .filter((key) => key.startsWith(prefix))
          .toSorted();
        return keys[0] === undefined ? null : localStorage.getItem(keys[0]);
      } catch {
        return unavailable;
      }
    },
    () => null
  );
  const decoded = useMemo(() => {
    if (raw === null || raw === unavailable) {
      return Option.none<T>();
    }
    try {
      return Schema.decodeUnknownOption(schema)(JSON.parse(raw));
    } catch {
      return Option.none<T>();
    }
  }, [raw, schema]);
  let readError: string | undefined;
  if (raw === unavailable) {
    readError = "Allow browser storage before submitting changes.";
  } else if (raw !== null && Option.isNone(decoded)) {
    readError =
      "A saved request couldn’t be read. Keep this browser’s data and reload before making another change.";
  }
  return {
    error: readError ?? writeError,
    pending: Option.getOrUndefined(decoded),
    release: (id: string) => {
      try {
        localStorage.removeItem(prefix + id);
        setWriteError(undefined);
        window.dispatchEvent(new Event(eventName));
      } catch {
        setWriteError(
          "Your change succeeded, but its retry record couldn’t be cleared. You can safely check it again."
        );
      }
    },
    retain: (id: string, request: T) => {
      try {
        if (readError) {
          throw new Error(readError);
        }
        const key = prefix + id;
        const encoded = JSON.stringify(request);
        const previous = localStorage.getItem(key);
        if (previous !== null && previous !== encoded) {
          throw new Error("A pending request cannot be replaced.");
        }
        localStorage.setItem(key, encoded);
        setWriteError(undefined);
        window.dispatchEvent(new Event(eventName));
      } catch {
        setWriteError(
          "We couldn’t keep this request safely in your browser. Free some storage and try again; no new request was sent."
        );
        throw new Error("Request storage unavailable");
      }
    },
  };
};
