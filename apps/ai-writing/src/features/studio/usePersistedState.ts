import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { loadPersistedState as loadJson } from "./persistedState";

export const DEEP_HYDRATE_EVENT = "xiezuomanju:deep-hydrate";

function storageKey(projectId: string | undefined, key: string) {
  return projectId ? `deep:${projectId}:${key}` : null;
}

/** 通知各 deep:* 面板从 localStorage 重新载入（hydrate 写入后调用）。 */
export function notifyDeepHydrated(projectId: string) {
  try {
    window.dispatchEvent(
      new CustomEvent(DEEP_HYDRATE_EVENT, { detail: { projectId } }),
    );
  } catch {
    /* ignore */
  }
}

/** 项目内持久化的小型编辑状态；切换项目时重新载入，写入失败不影响编辑。 */
export function usePersistedState<T>(
  projectId: string | undefined,
  key: string,
  initial: T,
) {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const currentKey = storageKey(projectId, key);
  const [entry, setEntry] = useState(() => ({ key: currentKey, value: loadJson(currentKey, initial) }));
  const state = entry.key === currentKey ? entry.value : loadJson(currentKey, initial);
  const setState = useCallback((next: SetStateAction<T>) => setEntry(previous => {
    const value = previous.key === currentKey ? previous.value : loadJson(currentKey, initialRef.current);
    return { key: currentKey, value: typeof next === "function" ? (next as (value: T) => T)(value) : next };
  }), [currentKey]);

  useEffect(() => {
    setState(loadJson(storageKey(projectId, key), initial));
    // initial 仅作为缺省值，不参与项目切换后的重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, key]);

  useEffect(() => {
    if (!projectId) return;
    const onHydrate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      setState(loadJson(storageKey(projectId, key), initial));
    };
    window.addEventListener(DEEP_HYDRATE_EVENT, onHydrate);
    return () => window.removeEventListener(DEEP_HYDRATE_EVENT, onHydrate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, key]);

  useEffect(() => {
    if (!currentKey || entry.key !== currentKey) return;
    try {
      localStorage.setItem(currentKey, JSON.stringify(state));
    } catch {
      /* quota / private mode：保留内存状态 */
    }
  }, [currentKey, entry, state]);

  return [state, setState] as const;
}
