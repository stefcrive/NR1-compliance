import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

type PersistedStateEnvelope = {
  version: number;
  value: unknown;
};

type PersistedStateOptions<T> = {
  version?: number;
  storage?: "session" | "local";
  serialize?: (value: T) => unknown;
  deserialize?: (value: unknown) => T | null;
};

const STORAGE_PREFIX = "nr1:page-state";

function resolveStorage(storageType: "session" | "local"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return storageType === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function isEnvelope(value: unknown): value is PersistedStateEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { version?: unknown; value?: unknown };
  return typeof candidate.version === "number" && "value" in candidate;
}

function storageKey(key: string) {
  return `${STORAGE_PREFIX}:${key}`;
}

export function usePersistedState<T>(
  key: string,
  initialValue: T,
  options?: PersistedStateOptions<T>,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const version = options?.version ?? 1;
  const storageType = options?.storage ?? "session";
  const serializeRef = useRef<(value: T) => unknown>(options?.serialize ?? ((value) => value));
  const deserializeRef = useRef<(value: unknown) => T | null>(
    options?.deserialize ?? ((value) => value as T),
  );
  const [value, setValue] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);
  const hasRestoredFromStorageRef = useRef(false);

  serializeRef.current = options?.serialize ?? ((nextValue) => nextValue);
  deserializeRef.current = options?.deserialize ?? ((nextValue) => nextValue as T);

  useEffect(() => {
    const storage = resolveStorage(storageType);
    if (!storage) {
      hasRestoredFromStorageRef.current = true;
      setIsHydrated(true);
      return;
    }

    try {
      const raw = storage.getItem(storageKey(key));
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;

      if (isEnvelope(parsed)) {
        if (parsed.version !== version) return;
        const restored = deserializeRef.current(parsed.value);
        if (restored !== null) {
          setValue(restored);
        }
        return;
      }

      // Backward-compatible fallback for older plain values.
      const restored = deserializeRef.current(parsed);
      if (restored !== null) {
        setValue(restored);
      }
    } catch {
      // Ignore malformed persisted data and keep default state.
    } finally {
      hasRestoredFromStorageRef.current = true;
      setIsHydrated(true);
    }
  }, [key, storageType, version]);

  useEffect(() => {
    if (!hasRestoredFromStorageRef.current) return;
    const storage = resolveStorage(storageType);
    if (!storage) return;

    try {
      const payload: PersistedStateEnvelope = {
        version,
        value: serializeRef.current(value),
      };
      storage.setItem(storageKey(key), JSON.stringify(payload));
    } catch {
      // Ignore write failures (quota/private mode).
    }
  }, [key, storageType, value, version]);

  return [value, setValue, isHydrated];
}

