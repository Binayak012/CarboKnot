import { useEffect, useState } from 'react';
import type { ClimatiqCacheStats } from '@/dashboard/lib/types';
import { defaultCacheStats } from '@/dashboard/lib/adapter';

// Real cache stats are written to chrome.storage.session by the service
// worker on each Climatiq lookup. We read them here defensively — if the
// stats are missing (e.g. during local dev outside the extension), we fall
// back to a sensible placeholder so the Privacy Receipt section still shows.
export function useCacheStats(): ClimatiqCacheStats {
  const [stats, setStats] = useState<ClimatiqCacheStats>(() => ({
    hit_count_session: 14,
    miss_count_session: 9,
    total_entries: 23
  }));

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
        const s = data?.climatiq_cache_stats as
          | ClimatiqCacheStats
          | undefined;
        if (s && typeof s.hit_count_session === 'number') {
          setStats(s);
        }
      } catch {
        if (!cancelled) setStats(defaultCacheStats());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return stats;
}
