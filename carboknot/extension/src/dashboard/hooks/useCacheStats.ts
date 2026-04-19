import { useEffect, useState } from 'react';
import type { ClimatiqCacheStats } from '@/dashboard/lib/types';
import { isExtensionContext } from '@/dashboard/lib/env';

// Real cache stats are written to chrome.storage.session by the service
// worker on each Climatiq lookup. We read them defensively:
//   - In the real extension: start at zeros so we never display fake
//     counts. Replace with the real numbers as soon as they arrive.
//   - In the standalone Vite preview (no extension context, no service
//     worker): use a small placeholder so the Privacy Receipt section
//     still renders something during design work.
const PREVIEW_DEFAULTS: ClimatiqCacheStats = {
  hit_count_session: 14,
  miss_count_session: 9,
  total_entries: 23
};

const ZERO_STATS: ClimatiqCacheStats = {
  hit_count_session: 0,
  miss_count_session: 0,
  total_entries: 0
};

export interface CacheStatsResult {
  stats: ClimatiqCacheStats;
  isSeed: boolean;
}

export function useCacheStats(): CacheStatsResult {
  const inExtension = isExtensionContext();
  const [stats, setStats] = useState<ClimatiqCacheStats>(() =>
    inExtension ? ZERO_STATS : PREVIEW_DEFAULTS
  );
  const [isSeed, setIsSeed] = useState<boolean>(!inExtension);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (
          typeof chrome === 'undefined' ||
          !chrome.storage ||
          !chrome.storage.session
        ) {
          return;
        }
        const data = await chrome.storage.session.get('climatiq_cache_stats');
        if (cancelled) return;
        const s = data?.climatiq_cache_stats as ClimatiqCacheStats | undefined;
        if (s && typeof s.hit_count_session === 'number') {
          setStats(s);
          setIsSeed(false);
        }
      } catch {
        if (!cancelled && inExtension) {
          setStats(ZERO_STATS);
          setIsSeed(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inExtension]);

  return { stats, isSeed };
}
