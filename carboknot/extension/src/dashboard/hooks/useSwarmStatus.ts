import { useEffect, useState } from 'react';

// Shape matches what proxy/index.js#handleSwarmCacheStatus returns and
// what the service worker persists to settings under 'swarm_status'.
export type SwarmStatus = {
  last_refresh: string | null;
  refreshed_categories: string[];
  factor_count: number;
  source: 'dedalus_swarm' | 'fallback';
  refresh_interval_min?: number;
  last_refresh_duration_ms?: number;
  warmer_enabled?: boolean;
};

const DEFAULT: SwarmStatus = {
  last_refresh: null,
  refreshed_categories: [],
  factor_count: 0,
  source: 'fallback'
};

/**
 * Pulls the latest Dedalus Machine warmer status for the dashboard's
 * "Swarm Cache" tile. Does two things on mount:
 *
 *   1. Reads the cached settings row so the tile has something to show
 *      instantly.
 *   2. Fires a `swarm_status_refresh` message to the service worker so
 *      numbers are never older than page-load time.
 *
 * Handles missing chrome APIs (e.g. running inside a plain browser tab
 * during dev) by silently returning defaults.
 */
export function useSwarmStatus(): {
  status: SwarmStatus;
  refresh: () => void;
  hydrate: () => void;
  hydrating: boolean;
} {
  const [status, setStatus] = useState<SwarmStatus>(DEFAULT);
  const [hydrating, setHydrating] = useState(false);

  const pullFromMessage = () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
      chrome.runtime.sendMessage(
        { type: 'swarm_status_refresh' },
        (res: { ok?: boolean; status?: SwarmStatus } | undefined) => {
          if (res?.ok && res.status) {
            setStatus((prev) => ({ ...prev, ...res.status }));
          }
        }
      );
    } catch {
      // no-op: chrome.runtime can throw when the SW is inactive.
    }
  };

  const hydrate = () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    setHydrating(true);
    try {
      chrome.runtime.sendMessage({ type: 'swarm_cache_hydrate' }, () => {
        setHydrating(false);
        pullFromMessage();
      });
    } catch {
      setHydrating(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        // The SW writes through dexie's settings table, not chrome.storage.
        // So we go via runtime message in both steps.
        pullFromMessage();
        if (cancelled) return;
      } catch {
        /* no-op */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, refresh: pullFromMessage, hydrate, hydrating };
}
