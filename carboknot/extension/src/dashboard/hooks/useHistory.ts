// Loads view history from the local Dexie DB.
//
// Behavior contract:
//   - In the real Chrome extension we ALWAYS reflect what is in Dexie. If
//     the table is empty, `rows` is an empty array and the dashboard shows
//     a friendly empty-state. We never inject seed data into a real install.
//   - In the standalone Vite preview (no extension context, e.g.
//     localhost:4173) we fall back to SEED_VIEWS once the empty load
//     completes, so the design preview is never hollow.
//
// `loading` flips to false as soon as the first read finishes, regardless
// of whether the result was empty.
// `isSeed` is true only when the rendered rows are demo content.

import { useEffect, useState } from 'react';
import { getHistory } from '@/storage/db.js';
import { adaptViewRows } from '@/dashboard/lib/adapter';
import { SEED_VIEWS } from '@/dashboard/lib/seed';
import { isExtensionContext } from '@/dashboard/lib/env';
import type { ViewRow } from '@/dashboard/lib/types';

export interface HistoryResult {
  rows: ViewRow[];
  loading: boolean;
  isSeed: boolean;
}

export function useHistory(): HistoryResult {
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSeed, setIsSeed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const inExtension = isExtensionContext();

    (async () => {
      try {
        const dexieRows = await getHistory();
        if (cancelled) return;
        if (dexieRows && dexieRows.length > 0) {
          setRows(adaptViewRows(dexieRows));
          setIsSeed(false);
        } else if (inExtension) {
          setRows([]);
          setIsSeed(false);
        } else {
          setRows(SEED_VIEWS);
          setIsSeed(true);
        }
      } catch (err) {
        console.warn('[carboknot] dashboard history load failed', err);
        if (cancelled) return;
        if (inExtension) {
          setRows([]);
          setIsSeed(false);
        } else {
          setRows(SEED_VIEWS);
          setIsSeed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { rows, loading, isSeed };
}
