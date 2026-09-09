"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  asWindChimeClientError,
  type WindChimeClient,
  type WindChimeClientError,
  type WindChimeResource,
} from "../client/index.js";

type WindChimeChangeSource = Pick<WindChimeClient, "subscribe">;
export type WindChimeResourceOptions = {
  enabled?: boolean;
  pollIntervalMs?: number;
};
/** Each key is a scope boundary: both abort and sequence checks protect against transports ignoring abort. */
export function useWindChimeResource<T>(
  client: WindChimeChangeSource,
  resource: WindChimeResource,
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  options: WindChimeResourceOptions = {},
) {
  const enabled = options.enabled !== false;
  const scope = `${key}:${enabled}`;
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const loader = useRef(load);
  loader.current = load;
  const serial = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    client: WindChimeChangeSource;
    scope: string;
    data: T | null;
    isLoading: boolean;
    error: WindChimeClientError | null;
  }>({ client, scope, data: null, isLoading: enabled, error: null });
  const reload = useCallback(async () => {
    controller.current?.abort();
    const sequence = ++serial.current;
    if (!enabled) {
      setState({ client, scope, data: null, isLoading: false, error: null });
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setState((old) => ({
      client,
      scope,
      data: old.scope === scope && old.client === client ? old.data : null,
      isLoading: true,
      error: null,
    }));
    try {
      const data = await loader.current(current.signal);
      if (
        serial.current === sequence &&
        liveScope.current === scope &&
        !current.signal.aborted
      )
        setState({ client, scope, data, isLoading: false, error: null });
    } catch (error) {
      if (
        serial.current === sequence &&
        liveScope.current === scope &&
        !current.signal.aborted
      )
        setState((old) => ({
          ...old,
          scope,
          isLoading: false,
          error: asWindChimeClientError(error),
        }));
    }
  }, [scope, enabled, client]);
  useEffect(() => {
    void reload();
    const unsubscribe = client.subscribe((changed) => {
      if (changed.includes(resource)) void reload();
    });
    const timer =
      enabled && options.pollIntervalMs
        ? setInterval(() => void reload(), options.pollIntervalMs)
        : undefined;
    return () => {
      ++serial.current;
      controller.current?.abort();
      unsubscribe();
      if (timer) clearInterval(timer);
    };
  }, [client, resource, reload, enabled, options.pollIntervalMs]);
  return {
    ...(state.scope === scope && state.client === client && enabled
      ? state
      : { data: null, isLoading: enabled, error: null }),
    reload,
  };
}

export function useWindChimeMutation(scope = "") {
  const liveScope = useRef(scope);
  const revision = useRef(0);
  if (liveScope.current !== scope) {
    liveScope.current = scope;
    ++revision.current;
  }
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [state, setState] = useState<{
    scope: string;
    revision: number;
    count: number;
    error: WindChimeClientError | null;
  }>({ scope, revision: 0, count: 0, error: null });
  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      const generation = revision.current;
      setState((old) => ({
        scope,
        revision: generation,
        count:
          (old.scope === scope && old.revision === generation ? old.count : 0) +
          1,
        error: null,
      }));
      try {
        return await action();
      } catch (error) {
        const failure = asWindChimeClientError(error);
        if (
          mounted.current &&
          liveScope.current === scope &&
          revision.current === generation
        )
          setState((old) => ({ ...old, error: failure }));
        throw failure;
      } finally {
        if (
          mounted.current &&
          liveScope.current === scope &&
          revision.current === generation
        )
          setState((old) => ({ ...old, count: Math.max(0, old.count - 1) }));
      }
    },
    [scope],
  );
  const current = state.scope === scope && state.revision === revision.current;
  return {
    run,
    pending: current && state.count > 0,
    mutationError: current ? state.error : null,
  };
}
