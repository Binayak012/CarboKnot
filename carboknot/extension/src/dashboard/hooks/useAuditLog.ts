// Reads the local IndexedDB audit_log. This is the ONLY surface the
// dashboard has for inspecting what the extension has done on the user's
// behalf — view logs, proxy round-trips, K2 narration views, etc.
//
// Polling is cheap (audit_log is local) and keeps the ledger live during
// a demo when new events arrive from the service worker / content script
// while the dashboard tab is already open.
//
// In the real extension we ALWAYS reflect Dexie. If the table is empty,
// `rows` is `[]` and the Activity Ledger renders an empty-state.
// In the standalone Vite preview (no extension context) we fall back to
// SEED_AUDIT so the section has something to render during design work.

import { useEffect, useState } from 'react';
import { getAuditLog } from '@/storage/db.js';
import { SEED_AUDIT } from '@/dashboard/lib/seed';
import { isExtensionContext } from '@/dashboard/lib/env';
import type { AuditEntry } from '@/dashboard/lib/types';

export type { AuditEntry };

export interface AuditLogResult {
  rows: AuditEntry[];
  isSeed: boolean;
}

const POLL_MS = 5000;
const DEFAULT_LIMIT = 25;

export function useAuditLog(limit = DEFAULT_LIMIT): AuditLogResult {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [isSeed, setIsSeed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const inExtension = isExtensionContext();

    const pull = async () => {
      try {
        const next = (await getAuditLog(limit)) as AuditEntry[];
        if (cancelled) return;
        if (Array.isArray(next) && next.length > 0) {
          setRows(next);
          setIsSeed(false);
        } else if (inExtension) {
          setRows([]);
          setIsSeed(false);
        } else {
          setRows(SEED_AUDIT.slice(0, limit));
          setIsSeed(true);
        }
      } catch {
        if (cancelled) return;
        if (inExtension) {
          setRows([]);
          setIsSeed(false);
        } else {
          setRows(SEED_AUDIT.slice(0, limit));
          setIsSeed(true);
        }
      }
    };

    pull();
    const t = setInterval(pull, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [limit]);

  return { rows, isSeed };
}
