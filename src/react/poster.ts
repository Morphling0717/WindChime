"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  readWindChimePosterConfig,
  writeWindChimePosterConfig,
  type WindChimeQrPosterConfig,
} from "../media/index.js";
export function useWindChimePosterConfig(
  initial: WindChimeQrPosterConfig,
  options: { storageKey?: string } = {},
) {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const [value, setValueState] = useState(initial);
  const current = useRef(value);
  current.current = value;
  useEffect(() => {
    const next = options.storageKey
      ? readWindChimePosterConfig(options.storageKey, initialRef.current)
      : initialRef.current;
    current.current = next;
    setValueState(next);
  }, [options.storageKey]);
  const setValue = useCallback(
    (next: SetStateAction<WindChimeQrPosterConfig>) => {
      const resolved =
        typeof next === "function" ? next(current.current) : next;
      current.current = resolved;
      setValueState(resolved);
      if (options.storageKey)
        writeWindChimePosterConfig(options.storageKey, resolved);
    },
    [options.storageKey],
  );
  const update = useCallback(
    (patch: Partial<WindChimeQrPosterConfig>) =>
      setValue((old) => ({ ...old, ...patch })),
    [setValue],
  );
  return { value, setValue, update };
}
