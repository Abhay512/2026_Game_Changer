import { useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Small LRU of decoded responses: scrubbing back to a window seen before is instant.
const cache = new Map<string, unknown>();
const MAX_CACHE = 300;

function remember(url: string, data: unknown) {
  cache.delete(url);
  cache.set(url, data);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  if (cache.has(url)) return cache.get(url) as T;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (res.status === 401) {
    // the login ended (idle too long, or logged out in another tab): reloading shows the login page,
    // and after logging in the same URL brings this view back
    window.location.reload();
    throw new ApiError(401, "Login required");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const data = (await res.json()) as T;
  remember(url, data);
  return data;
}

export function apiUrl(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return `/api/${path}${s ? `?${s}` : ""}`;
}

export interface Fetched<T> {
  data: T | null; // last successful result, kept while a new request is in flight
  loading: boolean;
  error: ApiError | Error | null;
}

/** Fetch `url` (null = idle). Aborts superseded requests; never blanks out previous data. */
export function useApi<T>(url: string | null): Fetched<T> {
  const [state, setState] = useState<Fetched<T>>(() => ({
    data: url && cache.has(url) ? (cache.get(url) as T) : null,
    loading: false,
    error: null,
  }));
  const latest = useRef(url);

  useEffect(() => {
    latest.current = url;
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    if (cache.has(url)) {
      setState({ data: cache.get(url) as T, loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    getJson<T>(url, ctrl.signal)
      .then((data) => latest.current === url && setState({ data, loading: false, error: null }))
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        if (latest.current === url) setState((s) => ({ ...s, loading: false, error }));
      });
    return () => ctrl.abort();
  }, [url]);

  return state;
}
