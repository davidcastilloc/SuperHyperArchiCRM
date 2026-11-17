import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MarketVocabulary, TenantMarketProfile } from '@shac/kernel';
import { DEFAULT_PROFILE } from '../nav';

export type ActiveMarketProfile = Pick<
  TenantMarketProfile,
  'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'
>;

const MarketProfileContext = createContext<ActiveMarketProfile>(DEFAULT_PROFILE);

export function MarketProfileProvider({
  profile,
  children,
}: {
  profile: ActiveMarketProfile;
  children: ReactNode;
}) {
  return <MarketProfileContext.Provider value={profile}>{children}</MarketProfileContext.Provider>;
}

/** Returns the active TenantMarketProfile from CONFIG_KV bootstrap. */
export function useMarketProfile(): ActiveMarketProfile {
  return useContext(MarketProfileContext);
}

/** Returns live chameleon MarketVocabulary per DESIGN.md §6. */
export function useMarketVocabulary(): MarketVocabulary {
  return useContext(MarketProfileContext).vocabulary;
}

/** Resolves bimodal UI density ('touch' 48-56px vs 'compact' 36px) per DESIGN.md §1. */
export function resolveRouteDensity(pathname: string): 'touch' | 'compact' {
  if (
    pathname === '/pos' ||
    pathname.startsWith('/kiosk/') ||
    pathname === '/physical' ||
    pathname === '/auth'
  ) {
    return 'touch';
  }
  return 'compact';
}

export function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  return online;
}

const THEME_KEY = 'shac.ui.theme.v1';

export function usePersistedTheme(pathname: string): ['light' | 'dark', () => void] {
  const [stored, setStored] = useState<'light' | 'dark' | null>(() => {
    try {
      const val = window.localStorage?.getItem(THEME_KEY);
      return val === 'dark' || val === 'light' ? val : null;
    } catch {
      return null;
    }
  });
  const effective: 'light' | 'dark' = stored ?? (pathname === '/physical' ? 'dark' : 'light');

  function toggle() {
    const next = effective === 'light' ? 'dark' : 'light';
    setStored(next);
    try {
      window.localStorage?.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }

  return [effective, toggle];
}
