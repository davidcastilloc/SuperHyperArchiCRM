import { useSyncExternalStore } from 'react';

interface AuthSessionActor {
  id: string;
  fullName: string;
  type: 'staff' | 'delegated_staff';
  tenantId: string;
  orgId: string;
  orgPath: string;
  branchName: string;
  perms: string[];
  delegatedById?: string;
}

export interface AuthSession {
  token: string;
  expiresAt: number;
  actor: AuthSessionActor;
}

const STORAGE_KEY = 'shac.auth.session.v1';
const listeners = new Set<() => void>();
let memorySession: AuthSession | null = null;
let initialized = false;

function getStorage(): Storage | null {
  if (
    typeof localStorage !== 'undefined' &&
    typeof localStorage.getItem === 'function' &&
    typeof localStorage.setItem === 'function' &&
    typeof localStorage.removeItem === 'function'
  ) {
    return localStorage;
  }
  return null;
}

function readInitialSession(): AuthSession | null {
  const storage = getStorage();
  if (!storage) return memorySession;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token || typeof parsed.expiresAt !== 'number') return null;
    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

/** Returns the active interactive session if present and unexpired. */
export function getAuthSession(): AuthSession | null {
  if (!initialized) {
    memorySession = readInitialSession();
    initialized = true;
  }
  if (memorySession && memorySession.expiresAt <= Math.floor(Date.now() / 1000)) {
    clearAuthSession();
    return null;
  }
  return memorySession;
}

/** Persists a new interactive session and notifies subscribers. */
export function setAuthSession(session: AuthSession): void {
  memorySession = session;
  initialized = true;
  getStorage()?.setItem(STORAGE_KEY, JSON.stringify(session));
  notify();
}

/** Clears the active interactive session and notifies subscribers. */
export function clearAuthSession(): void {
  memorySession = null;
  initialized = true;
  getStorage()?.removeItem(STORAGE_KEY);
  notify();
}

/** Subscribes a React component to interactive session changes. */
export function useAuthSession(): AuthSession | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getAuthSession,
    () => null,
  );
}
