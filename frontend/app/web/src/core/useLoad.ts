// Minimal async loader for page data: no cache, no dedupe. The app's data is
// small and per-screen, and core/api.ts already centralises auth and errors.
// `deps` re-runs the loader, like useEffect.
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./api";

interface LoadState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<LoadState<T>>({ data: null, error: null, loading: true });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return fn()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err) => setState({ data: null, error: errorMessage(err), loading: false }));
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
