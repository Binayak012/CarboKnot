import { useEffect, useState } from 'react';
import { getHistory } from '@/storage/db.js';
import { adaptViewRows } from '@/dashboard/lib/adapter';
import { SEED_VIEWS } from '@/dashboard/lib/seed';
import type { ViewRow } from '@/dashboard/lib/types';

export function useHistory(): ViewRow[] {
  const [rows, setRows] = useState<ViewRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dexieRows = await getHistory();
        if (cancelled) return;
        if (!dexieRows || dexieRows.length === 0) {
          // Empty DB → use seed so the dashboard has content during a demo.
          setRows(SEED_VIEWS);
          return;
        }
        setRows(adaptViewRows(dexieRows));
      } catch (err) {
        console.warn('[carboknot] dashboard history load failed, using seed', err);
        if (!cancelled) setRows(SEED_VIEWS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return rows;
}
