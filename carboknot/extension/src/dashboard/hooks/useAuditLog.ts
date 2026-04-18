// Reads the local IndexedDB audit_log. This is the ONLY surface the
// dashboard has for inspecting what the extension has done on the user's
// behalf — view logs, proxy round-trips, K2 narration views, etc.
//
// Polling is cheap (audit_log is local) and keeps the ledger live during
// a demo when new events arrive from the service worker / content script
// while the dashboard tab is already open.

import { useEffect, useState } from 'react';
import { getAuditLog } from '@/storage/db.js';

export type AuditEntry = {
  id?: number;
  event_type: string;
  timestamp: string;
  details?: Record<string, unknown>;
};

const POLL_MS = 5000;
const DEFAULT_LIMIT = 25;

export function useAuditLog(limit = DEFAULT_LIMIT): AuditEntry[] {
  const [rows, setRows] = useState<AuditEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const next = (await getAuditLog(limit)) as AuditEntry[];
        if (!cancelled) setRows(Array.isArray(next) ? next : []);
      } catch {
        if (!cancelled) setRows([]);
      }
    };

    pull();
    const t = setInterval(pull, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [limit]);

  return rows;
}
