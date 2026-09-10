'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WindChimeLiveClient } from '../client/live.js';
import type { WindChimeLiveAction, WindChimeLiveControlState } from '../core/live.js';

export function useWindChimeLiveControl(client: WindChimeLiveClient, topicId: string) {
  const [state, setState] = useState<WindChimeLiveControlState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const generation = useRef(0);
  const current = useRef<WindChimeLiveControlState | null>(null);
  const apply = useCallback((next: WindChimeLiveControlState) => {
    if (next.topicId !== topicId) return;
    const before = current.current;
    if (before && before.epoch === next.epoch && before.revision > next.revision) return;
    current.current = next; setState(next); setConnected(true);
  }, [topicId]);
  useEffect(() => {
    const key = ++generation.current;
    current.current = null; setState(null); setError(null); setConnected(false); setPending(false);
    let busy = false; let request: AbortController | undefined;
    const poll = async () => {
      if (busy) return;
      busy = true; request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 2500);
      try { const result = await client.state(topicId, request.signal); if (key === generation.current) { apply(result); setError(null); } }
      catch (failure) { if (key === generation.current) { setConnected(false); setError(failure instanceof Error ? failure.message : '连接中断'); } }
      finally { busy = false; clearTimeout(timeout); }
    };
    void poll(); const timer = setInterval(() => void poll(), 1000);
    return () => { ++generation.current; clearInterval(timer); request?.abort(); };
  }, [client, topicId, apply]);
  const actWithResult = useCallback(async (command: Omit<WindChimeLiveAction, 'topicId' | 'expectedRevision' | 'operationId'>): Promise<WindChimeLiveControlState | null> => {
    const before = current.current; if (!before) return null;
    const key = generation.current; setPending(true); setError(null);
    try {
      const next = await client.action({ ...command, topicId, expectedRevision: before.revision, operationId: crypto.randomUUID() });
      if (key === generation.current && next.topicId === topicId) { apply(next); return next; }
    } catch (failure) {
      if (key === generation.current) {
        setError(failure instanceof Error ? failure.message : '操作失败');
        const latest = await client.state(topicId).catch(() => null); if (latest && key === generation.current) apply(latest);
      }
    } finally { if (key === generation.current) setPending(false); }
    return null;
  }, [client, topicId, apply]);
  // Existing callers retain the boolean API; editors can acknowledge the exact action response.
  const act = useCallback(async (command: Parameters<typeof actWithResult>[0]) => !!(await actWithResult(command)), [actWithResult]);
  return { state: state?.topicId === topicId ? state : null, error, pending, connected: state?.topicId === topicId && connected, act, actWithResult };
}
