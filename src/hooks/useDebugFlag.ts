import { useCallback, useSyncExternalStore } from "react";

import { DEBUG_KEY } from "@/auth/appRoles";

const DEBUG_FLAG_CHANGE_EVENT = "sbts:debug-change";

function getDebugFlagSnapshot() {
  return typeof window !== "undefined" && window.localStorage.getItem(DEBUG_KEY) === "true";
}

function subscribeToDebugFlag(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === DEBUG_KEY) {
      onStoreChange();
    }
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(DEBUG_FLAG_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(DEBUG_FLAG_CHANGE_EVENT, onStoreChange);
  };
}

export function useDebugFlag() {
  const debugEnabled = useSyncExternalStore(
    subscribeToDebugFlag,
    getDebugFlagSnapshot,
    () => false,
  );

  const setDebugEnabled = useCallback((enabled: boolean) => {
    window.localStorage.setItem(DEBUG_KEY, String(enabled));
    window.dispatchEvent(new Event(DEBUG_FLAG_CHANGE_EVENT));
  }, []);

  return { debugEnabled, setDebugEnabled };
}
