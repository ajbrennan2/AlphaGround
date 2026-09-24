import { useCallback, useSyncExternalStore } from "react";

export function useTelemetry(store, key) {
    const subscribe = useCallback(listener => store.subscribe(key, listener), [store, key]);
    const getSnapshot = useCallback(() => store.getSnapshot(key), [store, key]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useHistory(store, group, index) {
    const key = `${group}.${index}`;
    const subscribe = useCallback(listener => store.subscribe(key, listener), [store, key]);
    const getSnapshot = useCallback(() => store.getHistory(key), [store, key]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
