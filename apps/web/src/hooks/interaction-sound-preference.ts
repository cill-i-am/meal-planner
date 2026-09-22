import { useSyncExternalStore } from "react";

const storageKey = "meal-planner:interaction-sound";
const changeEvent = "meal-planner:interaction-sound-change";
let sessionEnabled = true;

export const isInteractionSoundEnabled = () => {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved === null ? sessionEnabled : saved !== "off";
  } catch {
    return sessionEnabled;
  }
};

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(changeEvent, onChange);
  };
};

const setEnabled = (enabled: boolean) => {
  sessionEnabled = enabled;
  try {
    window.localStorage.setItem(storageKey, enabled ? "on" : "off");
  } catch {
    // The preference still works for this session when storage is unavailable.
  }
  window.dispatchEvent(new Event(changeEvent));
};

export const useInteractionSoundPreference = () => {
  const enabled = useSyncExternalStore(
    subscribe,
    isInteractionSoundEnabled,
    () => true
  );
  return { enabled, setEnabled };
};
