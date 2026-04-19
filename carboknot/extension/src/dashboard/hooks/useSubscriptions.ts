import { useEffect, useState, useCallback } from 'react';
import { getSubscriptions, updateSubscriptionStatus } from '@/storage/db.js';
import { SEED_SUBSCRIPTIONS } from '@/dashboard/lib/seed';
import { isExtensionContext } from '@/dashboard/lib/env';
import type { SubscriptionRow } from '@/dashboard/lib/types';

export interface SubscriptionsResult {
  subs: SubscriptionRow[];
  loading: boolean;
  isSeed: boolean;
  refresh: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
}

export function useSubscriptions(): SubscriptionsResult {
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSeed, setIsSeed] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await getSubscriptions();
      if (rows && rows.length > 0) {
        setSubs(rows as SubscriptionRow[]);
        setIsSeed(false);
      } else if (isExtensionContext()) {
        setSubs([]);
        setIsSeed(false);
      } else {
        setSubs(SEED_SUBSCRIPTIONS);
        setIsSeed(true);
      }
    } catch (err) {
      console.warn('[carboknot] subscriptions load failed', err);
      if (!isExtensionContext()) {
        setSubs(SEED_SUBSCRIPTIONS);
        setIsSeed(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ type: 'knot_subs_refresh' }, () => resolve());
      });
    }
    await load();
  }, [load]);

  const cancel = useCallback(async (id: string) => {
    // Optimistically mark as cancelling in local state.
    setSubs((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'CANCELLING' } : s))
    );

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: 'cancel_subscription', subscription_id: id },
        async () => {
          await load();
        }
      );
    } else {
      await updateSubscriptionStatus(id, 'CANCELLING');
      await load();
    }
  }, [load]);

  return { subs, loading, isSeed, refresh, cancel };
}
