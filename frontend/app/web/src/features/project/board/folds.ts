// Per-project view preferences that survive a reload: which cards are
// folded. Stored in localStorage under `ferrous.board.<projectId>.<name>`;
// every read and write is guarded, so a browser with storage blocked simply
// starts unfolded each time.
import { useCallback, useEffect, useRef, useState } from "react";

export const boardStorageKey = (projectId: string, name: string) => `ferrous.board.${projectId}.${name}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as T) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the preference lives for this page only.
  }
}

// A JSON object kept in sync with localStorage under `key` (build it with
// boardStorageKey). When the key changes -- the same page mounted for another
// project -- the value is re-read for the new key rather than carried over.
export function useStoredJson<T extends object>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, initial));
  const keyRef = useRef(key);
  const initialRef = useRef(initial);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    setValue(read(key, initialRef.current));
  }, [key]);
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        write(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, set];
}

// The common case: a map of id -> folded, with a per-id default.
export function useFoldMap(key: string, defaultFolded: (id: string) => boolean = () => false) {
  const [map, setMap] = useStoredJson<Record<string, boolean>>(key, {});
  const isFolded = useCallback((id: string) => map[id] ?? defaultFolded(id), [map, defaultFolded]);
  const toggle = useCallback((id: string) => setMap((m) => ({ ...m, [id]: !(m[id] ?? defaultFolded(id)) })), [setMap, defaultFolded]);
  return { isFolded, toggle };
}
