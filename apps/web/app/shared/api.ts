'use client';

import { useCallback, useEffect, useState } from 'react';

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
        : 'Confira os campos e tente novamente.',
    );
  return data as T;
}

export function useResources(paths: string[]) {
  const key = paths.join('|');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
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
        if (!signal?.aborted) setData(Object.fromEntries(entries));
      } catch (e) {
        if (!signal?.aborted)
          setError(
            e instanceof Error
              ? e.message
              : 'Não foi possível carregar os dados.',
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [key],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  return { data, loading, error, refresh };
}

export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function run<T>(
    operation: () => Promise<T>,
    success: string,
  ): Promise<T | undefined> {
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
      setBusy(false);
    }
  }
  return { busy, error, message, run };
}
