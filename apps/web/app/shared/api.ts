'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function announceResourcesChanged() {
  window.dispatchEvent(new Event('autoclips:resources'));
  localStorage.setItem('autoclips:resources', `${Date.now()}-${Math.random()}`);
}

export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.message === 'string'
        ? data.message
        : Array.isArray(data.message)
          ? data.message
              .map((issue: unknown) =>
                typeof issue === 'string'
                  ? issue
                  : issue && typeof issue === 'object' && 'message' in issue
                    ? String(issue.message)
                    : '',
              )
              .filter(Boolean)
              .slice(0, 3)
              .join('; ') || 'Confira os campos e tente novamente.'
          : 'Confira os campos e tente novamente.',
    );
  if (body !== undefined) announceResourcesChanged();
  return data as T;
}

export function useResources(paths: string[]) {
  const key = paths.join('|');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++sequence.current;
      setLoading(true);
      setError('');
      try {
        const entries = await Promise.all(
          key
            .split('|')
            .filter(Boolean)
            .map(
              async (path) =>
                [path, await api(path, undefined, signal)] as const,
            ),
        );
        if (!signal?.aborted && request === sequence.current)
          setData(Object.fromEntries(entries));
      } catch (e) {
        if (!signal?.aborted && request === sequence.current)
          setError(
            e instanceof Error
              ? e.message
              : 'Não foi possível carregar os dados.',
          );
      } finally {
        if (!signal?.aborted && request === sequence.current) setLoading(false);
      }
    },
    [key],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, 150);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') changed();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === 'autoclips:resources') changed();
    };
    window.addEventListener('autoclips:resources', changed);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('autoclips:resources', changed);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  return { data, loading, error, refresh };
}

export function useAction() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function run<T>(
    operation: () => Promise<T>,
    success: string,
  ): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await operation();
      setMessage(success);
      return result;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Não foi possível concluir a operação.',
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, error, message, run };
}
