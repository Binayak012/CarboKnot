// Carboknot — extension popup.
//
// A condensed companion to the full dashboard, tuned for the ~380px-wide
// chrome.action surface. Same data hooks (useHistory, useCacheStats) and
// the same editorial / acid-green theme. Three "screens" are reachable:
//   - home: snapshot + quick offset
//   - offset: dedicated mode picker + provider grid
//   - settings: compact network allowlist + reset
//
// Heavy modules used by the full dashboard (Recharts, base-ui dialogs,
// trace drawer) are intentionally NOT imported here so the popup bundle
// stays small and opens instantly.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings,
  ArrowUpRight,
  Activity,
  Package,
  MapPin,
  Leaf,
  ExternalLink,
  Copy,
  Check,
  Sprout,
  Mountain,
  Globe,
  Trees,
  ShieldCheck,
  AlertTriangle,
  Trash2,
  ChevronLeft,
  Cpu,
  HardDrive,
  Cloud,
  Database,
  TrendingDown,
  TrendingUp,
  Minus,
  LayoutDashboard,
  Maximize2
} from 'lucide-react';

import { useHistory } from '@/dashboard/hooks/useHistory';
import { useCacheStats } from '@/dashboard/hooks/useCacheStats';
import {
  buildCategoryTotals,
  getCategoryLabel
} from '@/dashboard/lib/utils-dashboard';
import { isExtensionContext } from '@/dashboard/lib/env';
import { resetAll } from '@/storage/db.js';
import { loadDemoData } from '@/dashboard/lib/loadDemoData';
import logoUrl from '@/assets/logo.png';

const ACID = '#b6ff3c';
const MONTHLY_BUDGET = 200;

/* ---------- offset providers (mirrors the dashboard) ---------- */

type OffsetProvider = {
  id: string;
  name: string;
  blurb: string;
  pricePerTonneUsd: [number, number];
  url: string;
  iconKey: 'sprout' | 'mountain' | 'globe' | 'trees';
};

const OFFSET_PROVIDERS: OffsetProvider[] = [
  {
    id: 'cooleffect',
    name: 'Cool Effect',
    blurb: 'Direct project funding. Verra · Gold Standard.',
    pricePerTonneUsd: [10, 15],
    url: 'https://www.cooleffect.org/buy-climate-solutions',
    iconKey: 'globe'
  },
  {
    id: 'goldstandard',
    name: 'Gold Standard',
    blurb: 'Premium verified credits. Highest rigor.',
    pricePerTonneUsd: [20, 30],
    url: 'https://marketplace.goldstandard.org/collections/projects',
    iconKey: 'trees'
  },
  {
    id: 'undo',
    name: 'UNDO',
    blurb: 'Permanent removal · enhanced rock weathering.',
    pricePerTonneUsd: [180, 250],
    url: 'https://un-do.com/buy-co2-removal',
    iconKey: 'mountain'
  },
  {
    id: 'myclimate',
    name: 'myclimate',
    blurb: 'Swiss non-profit. Calculator-based.',
    pricePerTonneUsd: [25, 40],
    url: 'https://co2.myclimate.org/en/offset_further_emissions',
    iconKey: 'sprout'
  }
];

const OFFSET_ICON: Record<OffsetProvider['iconKey'], typeof Globe> = {
  globe: Globe,
  trees: Trees,
  mountain: Mountain,
  sprout: Sprout
};

type OffsetMode = 'month' | 'total' | 'custom';

const OFFSET_MODES: { id: OffsetMode; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'total', label: 'Lifetime' },
  { id: 'custom', label: 'Custom' }
];

type Screen = 'home' | 'offset' | 'settings';

/* ---------- tiny shared atoms (no recharts) ---------- */

function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (last.current === target) return;
    last.current = target;
    const start = performance.now();
    const from = value;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) requestAnimationFrame(tick);
      else setValue(target);
    };
    requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);
  return value;
}

function MiniStat({
  label,
  value,
  sub,
  icon,
  acid
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  acid?: boolean;
}) {
  return (
    <div className="tile px-3 py-3 corner-mark">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-500">
          {label}
        </div>
        <div className={acid ? 'text-[#b6ff3c]' : 'text-zinc-600'}>{icon}</div>
      </div>
      <div
        className={`display-mono leading-none text-[18px] ${
          acid ? 'text-[#d8ffb0] acid-glow' : 'text-zinc-50'
        }`}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mt-1.5 truncate">
          {sub}
        </div>
      )}
    </div>
  );
}

/* ---------- dashboard launcher ---------- */

function openDashboard(hash?: string) {
  try {
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      chrome.runtime.id &&
      chrome.tabs?.create
    ) {
      const url =
        chrome.runtime.getURL('src/dashboard/index.html') +
        (hash ? `#${hash}` : '');
      chrome.tabs.create({ url });
      window.close();
      return;
    }
  } catch {
    // fall through
  }
  // Fallback for the standalone preview / web build.
  window.open('/' + (hash ? `#${hash}` : ''), '_blank');
}

/* =============================================================
   APP
   ============================================================= */

export default function PopupApp() {
  const { rows, loading } = useHistory();
  const { stats: cacheStats } = useCacheStats();

  const [screen, setScreen] = useState<Screen>('home');
  const [offsetMode, setOffsetMode] = useState<OffsetMode>('month');
  const [offsetCustomKg, setOffsetCustomKg] = useState<string>('25');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState<boolean>(false);
  const [demoLoading, setDemoLoading] = useState<boolean>(false);

  const handleLoadDemo = useCallback(async () => {
    if (demoLoading) return;
    setDemoLoading(true);
    try {
      await loadDemoData();
      window.location.reload();
    } catch (err) {
      console.warn('[carboknot] failed to load demo data', err);
      setDemoLoading(false);
    }
  }, [demoLoading]);

  const inExtension = isExtensionContext();

  /* ----- derived totals (confirmed-only, mirrors dashboard) ----- */

  const purchasedRows = useMemo(() => rows.filter((r) => r.purchased), [rows]);
  const viewedRows = useMemo(() => rows.filter((r) => !r.purchased), [rows]);

  const totalKg = useMemo(
    () => purchasedRows.reduce((s, r) => s + r.kg_total, 0),
    [purchasedRows]
  );
  const totalCiLow = useMemo(
    () => purchasedRows.reduce((s, r) => s + r.kg_ci_low, 0),
    [purchasedRows]
  );
  const totalCiHigh = useMemo(
    () => purchasedRows.reduce((s, r) => s + r.kg_ci_high, 0),
    [purchasedRows]
  );
  const totalCi = (totalCiHigh - totalCiLow) / 2;
  const milesDriven = Math.round(totalKg * 2.5);

  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).getTime();
  const monthKg = useMemo(
    () =>
      purchasedRows
        .filter((r) => r.ts >= startOfMonth)
        .reduce((s, r) => s + r.kg_total, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [purchasedRows]
  );
  const budgetPct = Math.min(100, (monthKg / MONTHLY_BUDGET) * 100);
  const budgetColor =
    budgetPct > 80 ? '#ef4444' : budgetPct > 60 ? '#f59e0b' : ACID;

  const DAY = 86400000;
  const now = Date.now();
  const thisWeekKg = useMemo(
    () =>
      purchasedRows
        .filter((r) => r.ts >= now - 7 * DAY)
        .reduce((s, r) => s + r.kg_total, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [purchasedRows]
  );
  const lastWeekKg = useMemo(
    () =>
      purchasedRows
        .filter((r) => r.ts >= now - 14 * DAY && r.ts < now - 7 * DAY)
        .reduce((s, r) => s + r.kg_total, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [purchasedRows]
  );
  const weekDelta =
    lastWeekKg > 0 ? ((thisWeekKg - lastWeekKg) / lastWeekKg) * 100 : 0;

  const categoryTotals = useMemo(() => buildCategoryTotals(rows), [rows]);
  const topCat = categoryTotals[0];

  /* ----- offset calculations ----- */

  const offsetCustomNum = useMemo(() => {
    const n = parseFloat(offsetCustomKg);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [offsetCustomKg]);
  const offsetKg = useMemo(() => {
    switch (offsetMode) {
      case 'month':
        return monthKg;
      case 'total':
        return totalKg;
      case 'custom':
        return offsetCustomNum;
      default:
        return 0;
    }
  }, [offsetMode, monthKg, totalKg, offsetCustomNum]);
  const offsetTonnes = offsetKg / 1000;
  const offsetCostMin =
    offsetTonnes *
    Math.min(...OFFSET_PROVIDERS.map((p) => p.pricePerTonneUsd[0]));
  const offsetCostMax =
    offsetTonnes *
    Math.max(...OFFSET_PROVIDERS.map((p) => p.pricePerTonneUsd[1]));

  const handleCopyKg = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 1400);
    } catch {
      /* clipboard not available — silent */
    }
  }, []);

  const animatedTotal = useCountUp(totalKg, 1100);

  /* ----- loading ----- */

  if (loading) {
    return (
      <div className="grid-bg p-6 min-h-[200px] flex items-center justify-center">
        <span className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-zinc-500">
          <span
            className="w-1.5 h-1.5 bg-[#b6ff3c] pulse-acid"
            aria-hidden="true"
          />
          Loading…
        </span>
      </div>
    );
  }

  /* ============================================================
     SCREEN: SETTINGS
     ============================================================ */
  if (screen === 'settings') {
    return (
      <div className="grid-bg text-zinc-100">
        <PopupHeader
          title="Settings"
          kicker="Network · Data · Methodology"
          onBack={() => {
            setScreen('home');
            setResetConfirm(false);
          }}
        />

        <div className="px-4 pb-4 space-y-3">
          {/* Network allowlist */}
          <section className="tile-acid p-4 corner-mark relative overflow-hidden">
            <div className="absolute inset-0 hatch opacity-30 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={11} className="text-[#b6ff3c]" />
                <span className="stencil text-[9px] text-[#d8ffb0]">
                  NETWORK ALLOWLIST
                </span>
                <div className="flex-1 ring-divider" />
                <span className="chip chip-acid !py-0.5 !px-1.5 !text-[8px]">
                  2 endpoints
                </span>
              </div>
              <ul className="space-y-2 text-[10px] font-mono leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="text-[#b6ff3c] mt-0.5">›</span>
                  <span>
                    <span className="text-zinc-200">/api/climatiq</span>
                    <span className="text-zinc-500">
                      {' '}
                      — ISIC4 + price only on first view of a new bucket.
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#b6ff3c] mt-0.5">›</span>
                  <span>
                    <span className="text-zinc-200">/api/reason</span>
                    <span className="text-zinc-500">
                      {' '}
                      — only on “Why is this lower carbon?” click.
                    </span>
                  </span>
                </li>
              </ul>
              <p className="text-[10px] text-zinc-500 mt-3 leading-relaxed font-mono">
                <span className="text-zinc-200">
                  No identity, URLs, or browsing history
                </span>{' '}
                are transmitted for carbon lookups.
              </p>
            </div>
          </section>

          {/* Privacy receipt — compact */}
          <section className="tile p-4 corner-mark">
            <div className="flex items-center gap-2 mb-3">
              <Cpu size={11} className="text-zinc-500" />
              <span className="stencil text-[9px] text-zinc-300">
                PRIVACY RECEIPT
              </span>
              <div className="flex-1" />
              <span className="chip !py-0.5 !px-1.5 !text-[8px]">SESSION</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <ReceiptStat
                icon={<HardDrive size={10} />}
                label="Cache"
                value={cacheStats.hit_count_session}
                sub="hits"
              />
              <ReceiptStat
                icon={<Cloud size={10} />}
                label="API"
                value={cacheStats.miss_count_session}
                sub="calls"
              />
              <ReceiptStat
                icon={<Database size={10} />}
                label="Disk"
                value={cacheStats.total_entries}
                sub="entries"
              />
            </div>
          </section>

          {/* Methodology */}
          <section className="tile p-4 corner-mark flex items-center justify-between gap-3">
            <div>
              <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">
                Methodology
              </div>
              <div className="display-mono text-[#b6ff3c] text-[18px] mt-1 acid-glow">
                v2.4.1
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">
                Source
              </div>
              <div className="text-[10px] text-zinc-300 font-mono uppercase tracking-widest mt-1">
                Climatiq · EXIOBASE
              </div>
            </div>
          </section>

          {/* Open full dashboard CTA */}
          <button
            onClick={() => openDashboard()}
            className="btn-block w-full justify-center"
          >
            <LayoutDashboard size={11} />
            Open full dashboard
            <ArrowUpRight size={11} />
          </button>

          {/* Danger zone */}
          <section className="border border-rose-900/50 bg-rose-950/20 p-4 corner-mark relative">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={13} className="text-rose-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="display text-zinc-100 text-[14px] mb-1">
                  Reset all data
                </div>
                <p className="text-[10px] text-zinc-400 mb-3 leading-relaxed font-mono">
                  Permanently clears cached estimates, view history, and audit
                  log. Cannot be undone.
                </p>
                {!resetConfirm ? (
                  <button
                    className="btn-block btn-block-sm"
                    style={{
                      borderColor: 'rgba(244, 63, 94, 0.5)',
                      background: 'rgba(244, 63, 94, 0.08)',
                      color: '#fda4af'
                    }}
                    onClick={() => setResetConfirm(true)}
                  >
                    <Trash2 size={10} />
                    Reset
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      className="btn-block btn-block-sm"
                      style={{
                        borderColor: 'rgba(244, 63, 94, 0.6)',
                        background: 'rgba(244, 63, 94, 0.15)',
                        color: '#fecdd3'
                      }}
                      onClick={async () => {
                        try {
                          await resetAll();
                        } catch (err) {
                          console.warn('[carboknot] reset failed', err);
                        }
                        setResetConfirm(false);
                        setScreen('home');
                      }}
                    >
                      <Trash2 size={10} />
                      Confirm wipe
                    </button>
                    <button
                      className="btn-block btn-block-sm"
                      onClick={() => setResetConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <PopupFooter />
        </div>
      </div>
    );
  }

  /* ============================================================
     SCREEN: OFFSET (dedicated)
     ============================================================ */
  if (screen === 'offset') {
    return (
      <div className="grid-bg text-zinc-100">
        <PopupHeader
          title="Offset"
          kicker="Make it right"
          onBack={() => setScreen('home')}
        />

        <div className="px-4 pb-4 space-y-3">
          <OffsetCard
            offsetMode={offsetMode}
            offsetKg={offsetKg}
            offsetTonnes={offsetTonnes}
            offsetCostMin={offsetCostMin}
            offsetCostMax={offsetCostMax}
            offsetCustomKg={offsetCustomKg}
            setOffsetMode={setOffsetMode}
            setOffsetCustomKg={setOffsetCustomKg}
            monthKg={monthKg}
            totalKg={totalKg}
            copiedKey={copiedKey}
            onCopy={handleCopyKg}
            expanded
          />

          <ProviderGrid
            offsetKg={offsetKg}
            offsetTonnes={offsetTonnes}
            copiedKey={copiedKey}
            onCopy={handleCopyKg}
          />

          <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 leading-relaxed">
            Carboknot does not transmit your kg figure. Pricing shown is a
            market-rate estimate; actual cost is set at provider checkout.
          </p>

          <PopupFooter />
        </div>
      </div>
    );
  }

  /* ============================================================
     SCREEN: HOME
     ============================================================ */

  const isEmpty = rows.length === 0;

  return (
    <div className="grid-bg text-zinc-100">
      {/* Header */}
      <header className="px-4 pt-4 pb-3 flex items-center gap-2">
        <img
          src={logoUrl}
          alt="Carboknot logo"
          width={32}
          height={32}
          className="h-8 w-8 object-contain shrink-0"
          draggable={false}
        />
        <div className="flex-1 min-w-0">
          <div className="display text-[22px] leading-none tracking-[-0.05em] text-zinc-50">
            Carbo<span className="text-[#b6ff3c]">K</span>not
          </div>
          <div className="text-[8px] font-mono uppercase tracking-[0.28em] text-zinc-500 mt-1">
            data‑first carbon receipt
          </div>
        </div>
        <button
          onClick={() => openDashboard()}
          className="btn-block btn-block-sm"
          title="Open full dashboard"
        >
          <Maximize2 size={10} />
        </button>
        <button
          onClick={() => setScreen('settings')}
          className="btn-block btn-block-sm"
          title="Settings"
        >
          <Settings size={10} />
        </button>
      </header>

      {/* Status pill */}
      <div className="px-4 pb-3 flex items-center gap-2">
        {inExtension ? (
          <span className="chip chip-acid !py-0.5 !px-1.5 !text-[8px]">
            <span className="w-1 h-1 rounded-full bg-[#b6ff3c] tick" />
            LIVE · LOCAL
          </span>
        ) : (
          <span
            className="chip !py-0.5 !px-1.5 !text-[8px]"
            style={{
              borderColor: 'rgba(251, 191, 36, 0.45)',
              color: '#fcd34d',
              background: 'rgba(251, 191, 36, 0.06)'
            }}
          >
            <AlertTriangle size={8} />
            DEMO
          </span>
        )}
        <span className="chip !py-0.5 !px-1.5 !text-[8px]">v0.1</span>
        <div className="flex-1" />
        <span className="text-[8px] font-mono uppercase tracking-widest text-zinc-600">
          {rows.length} rec · {purchasedRows.length} buy
        </span>
      </div>

      {isEmpty ? (
        <div className="px-4 pb-4 space-y-3">
          <div className="tile-acid p-5 corner-mark relative overflow-hidden">
            <div className="absolute inset-0 hatch opacity-30 pointer-events-none" />
            <div className="relative">
              <div className="stencil text-[9px] text-[#b6ff3c] mb-2">
                NO DATA YET
              </div>
              <h1 className="display text-zinc-50 text-[20px] leading-tight mb-2">
                Browse a product
                <br />
                to start tracking.
              </h1>
              <p className="text-[10px] text-zinc-400 leading-relaxed font-mono">
                Open any product page on a supported merchant — Carboknot logs
                a kg estimate the moment the page loads.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <a
              href="https://www.amazon.com"
              target="_blank"
              rel="noopener noreferrer"
              className="tile p-3 corner-mark hover:border-[rgba(182,255,60,0.35)] transition-colors group"
            >
              <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
                Try
              </div>
              <div className="display text-zinc-100 text-[14px] flex items-center justify-between">
                Amazon
                <ArrowUpRight
                  size={12}
                  className="text-zinc-600 group-hover:text-[#b6ff3c]"
                />
              </div>
            </a>
            <a
              href="https://www.ebay.com"
              target="_blank"
              rel="noopener noreferrer"
              className="tile p-3 corner-mark hover:border-[rgba(182,255,60,0.35)] transition-colors group"
            >
              <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
                Try
              </div>
              <div className="display text-zinc-100 text-[14px] flex items-center justify-between">
                eBay
                <ArrowUpRight
                  size={12}
                  className="text-zinc-600 group-hover:text-[#b6ff3c]"
                />
              </div>
            </a>
          </div>
          <button
            onClick={handleLoadDemo}
            disabled={demoLoading}
            className="btn-block w-full justify-center disabled:opacity-50 disabled:cursor-wait"
          >
            <Sprout size={11} />
            {demoLoading ? 'Loading demo data…' : 'Load demo data'}
          </button>
          <p className="text-[8px] font-mono uppercase tracking-widest text-zinc-600 text-center -mt-1">
            Local only · audit-logged · clear from settings
          </p>
          <button
            onClick={() => openDashboard()}
            className="btn-block w-full justify-center"
          >
            <LayoutDashboard size={11} />
            Open full dashboard
            <ArrowUpRight size={11} />
          </button>
          <PopupFooter />
        </div>
      ) : (
        <div className="px-4 pb-4 space-y-3">
          {/* Total monolith */}
          <section className="tile-hero p-4 corner-mark relative overflow-hidden">
            <div className="absolute inset-0 hatch opacity-50 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[9px] font-mono uppercase tracking-[0.28em] text-[#b6ff3c]">
                  Total CO₂ saved-tracked
                </div>
                <div className="chip chip-acid !py-0.5 !px-1.5 !text-[8px]">
                  <span className="w-1 h-1 rounded-full bg-[#b6ff3c] tick" />
                  Confirmed
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="display text-[#d8ffb0] acid-glow leading-[0.78] text-[56px]">
                  {animatedTotal.toFixed(1)}
                </div>
                <div className="pb-1.5">
                  <div className="display-mono text-[#b6ff3c] text-[16px] leading-none">
                    kg
                  </div>
                  <div className="text-[8px] font-mono uppercase tracking-widest text-zinc-500 mt-0.5">
                    CO₂e
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[9px] font-mono text-[#7d8a82] flex flex-wrap gap-x-2.5 gap-y-1">
                <span>± {totalCi.toFixed(1)} kg CI</span>
                <span className="text-[#3a4540]">/</span>
                <span>≈ {milesDriven.toLocaleString()} mi driven</span>
                <span className="text-[#3a4540]">/</span>
                <span>{viewedRows.length} browsing</span>
              </div>
            </div>
          </section>

          {/* Budget bar */}
          <section className="tile p-4 corner-mark">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[9px] font-mono uppercase tracking-[0.28em] text-zinc-500">
                This month
              </div>
              <div
                className={`flex items-center gap-1 text-[9px] font-mono ${
                  weekDelta > 0
                    ? 'text-rose-400'
                    : weekDelta < 0
                    ? 'text-[#b6ff3c]'
                    : 'text-zinc-500'
                }`}
              >
                {weekDelta > 0 ? (
                  <TrendingUp size={9} />
                ) : weekDelta < 0 ? (
                  <TrendingDown size={9} />
                ) : (
                  <Minus size={9} />
                )}
                {Math.abs(weekDelta).toFixed(0)}% wk
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <div className="display-mono text-zinc-50 text-[26px] leading-none">
                {monthKg.toFixed(0)}
              </div>
              <div className="text-[10px] font-mono text-zinc-500">
                / {MONTHLY_BUDGET} kg cap · {budgetPct.toFixed(0)}%
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-[#0d1612] relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 transition-all duration-700"
                style={{
                  width: `${budgetPct}%`,
                  backgroundColor: budgetColor,
                  boxShadow: `0 0 8px ${budgetColor}`
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-zinc-600">
              <span>used {monthKg.toFixed(0)} kg</span>
              <span style={{ color: budgetColor }}>
                {Math.max(0, MONTHLY_BUDGET - monthKg).toFixed(0)} kg left
              </span>
            </div>
          </section>

          {/* Quick stats */}
          <section className="grid grid-cols-3 gap-2">
            <MiniStat
              label="Buys"
              value={String(purchasedRows.length)}
              sub="confirmed"
              icon={<Package size={11} />}
              acid
            />
            <MiniStat
              label="Miles"
              value={milesDriven.toLocaleString()}
              sub="driven eq."
              icon={<MapPin size={11} />}
            />
            <MiniStat
              label="Top"
              value={topCat ? `${topCat.kg.toFixed(0)}kg` : '—'}
              sub={topCat ? getCategoryLabel(topCat.category) : 'no data'}
              icon={<Activity size={11} />}
            />
          </section>

          {/* Offset compact */}
          <OffsetCard
            offsetMode={offsetMode}
            offsetKg={offsetKg}
            offsetTonnes={offsetTonnes}
            offsetCostMin={offsetCostMin}
            offsetCostMax={offsetCostMax}
            offsetCustomKg={offsetCustomKg}
            setOffsetMode={setOffsetMode}
            setOffsetCustomKg={setOffsetCustomKg}
            monthKg={monthKg}
            totalKg={totalKg}
            copiedKey={copiedKey}
            onCopy={handleCopyKg}
          />

          {/* Provider quick row */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[9px] font-mono uppercase tracking-[0.28em] text-zinc-500">
                Quick offset
              </div>
              <button
                onClick={() => setScreen('offset')}
                className="text-[9px] font-mono uppercase tracking-widest text-[#b6ff3c] hover:underline flex items-center gap-1"
              >
                All providers <ArrowUpRight size={10} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {OFFSET_PROVIDERS.slice(0, 4).map((p) => {
                const Icon = OFFSET_ICON[p.iconKey];
                return (
                  <a
                    key={p.id}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tile p-3 corner-mark group hover:border-[rgba(182,255,60,0.35)] transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={11} className="text-[#b6ff3c]" />
                      <span className="display text-zinc-100 text-[12px] truncate">
                        {p.name}
                      </span>
                      <ArrowUpRight
                        size={10}
                        className="ml-auto text-zinc-600 group-hover:text-[#b6ff3c]"
                      />
                    </div>
                    <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">
                      ${p.pricePerTonneUsd[0]}–${p.pricePerTonneUsd[1]}/t
                    </div>
                  </a>
                );
              })}
            </div>
          </section>

          {/* Footer actions */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => setScreen('offset')}
              className="btn-block justify-center"
            >
              <Leaf size={11} />
              Offset
            </button>
            <button
              onClick={() => openDashboard()}
              className="btn-block btn-block-active justify-center"
            >
              <LayoutDashboard size={11} />
              Dashboard
            </button>
          </div>

          <PopupFooter />
        </div>
      )}
    </div>
  );
}

/* =============================================================
   SUB-COMPONENTS
   ============================================================= */

function PopupHeader({
  title,
  kicker,
  onBack
}: {
  title: string;
  kicker: string;
  onBack: () => void;
}) {
  return (
    <header className="px-4 pt-4 pb-3 flex items-center gap-2">
      <button
        onClick={onBack}
        className="btn-block btn-block-sm"
        title="Back"
      >
        <ChevronLeft size={11} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-[8px] font-mono uppercase tracking-[0.28em] text-zinc-500">
          {kicker}
        </div>
        <div className="display text-zinc-50 text-[18px] leading-tight tracking-tight">
          {title}
        </div>
      </div>
      <span className="chip chip-acid !py-0.5 !px-1.5 !text-[8px]">REC</span>
    </header>
  );
}

function PopupFooter() {
  return (
    <div className="pt-2 mt-2 border-t border-[var(--rule)] flex items-center justify-between text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-600">
      <span className="flex items-center gap-1.5">
        <span className="w-1 h-1 bg-[#b6ff3c] pulse-acid" />
        local-first
      </span>
      <span>v0.1 · v2.4.1</span>
      <a
        href="https://github.com/Binayak012/CarboKnot"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-[#b6ff3c] transition-colors flex items-center gap-1"
      >
        Source <ExternalLink size={8} />
      </a>
    </div>
  );
}

function ReceiptStat({
  icon,
  label,
  value,
  sub
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <div className="border border-[var(--rule)] bg-[#04080a]/60 px-2 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[8px] font-mono uppercase tracking-widest text-zinc-500">
          {label}
        </div>
        <div className="text-[#b6ff3c]">{icon}</div>
      </div>
      <div className="display-mono text-[#d8ffb0] text-[18px] leading-none acid-glow">
        {value}
      </div>
      <div className="text-[8px] text-zinc-600 mt-1 font-mono uppercase tracking-widest">
        {sub}
      </div>
    </div>
  );
}

function OffsetCard({
  offsetMode,
  offsetKg,
  offsetTonnes,
  offsetCostMin,
  offsetCostMax,
  offsetCustomKg,
  setOffsetMode,
  setOffsetCustomKg,
  monthKg,
  totalKg,
  copiedKey,
  onCopy,
  expanded = false
}: {
  offsetMode: OffsetMode;
  offsetKg: number;
  offsetTonnes: number;
  offsetCostMin: number;
  offsetCostMax: number;
  offsetCustomKg: string;
  setOffsetMode: (m: OffsetMode) => void;
  setOffsetCustomKg: (v: string) => void;
  monthKg: number;
  totalKg: number;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  expanded?: boolean;
}) {
  return (
    <section className="tile-acid p-4 corner-mark relative overflow-hidden">
      <div className="pointer-events-none absolute -right-10 -top-10 w-40 h-40 bg-[#b6ff3c]/10 blur-3xl rounded-full" />
      <div className="relative">
        <div className="flex items-center gap-1.5 mb-3">
          <Leaf size={11} className="text-[#b6ff3c]" />
          <span className="stencil text-[9px] text-[#b6ff3c]">
            OFFSET TARGET
          </span>
        </div>

        {/* Mode picker */}
        <div className="grid grid-cols-3 gap-1 mb-3">
          {OFFSET_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setOffsetMode(m.id)}
              className={`btn-block btn-block-sm justify-center !py-1 ${
                offsetMode === m.id ? 'btn-block-active' : ''
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Custom input */}
        {offsetMode === 'custom' && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={offsetCustomKg}
                onChange={(e) => setOffsetCustomKg(e.target.value)}
                className="flex-1 bg-[#0a110d] border border-[var(--rule)] text-zinc-100 display-mono text-[14px] px-2 py-1.5 outline-none focus:border-[rgba(182,255,60,0.45)] hover:border-[rgba(182,255,60,0.25)] transition-colors"
                placeholder="25"
              />
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                kg
              </span>
            </div>
            {expanded && (
              <div className="flex flex-wrap gap-1 mt-2">
                {[10, 25, 50, 100, 250].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setOffsetCustomKg(String(preset))}
                    className="btn-block btn-block-sm !py-0.5 !px-2"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Big kg + cost */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="display-mono text-[#b6ff3c] text-[34px] leading-none acid-glow">
            {offsetKg.toFixed(offsetKg < 10 ? 1 : 0)}
          </span>
          <span className="text-[12px] font-mono text-zinc-300">
            kg CO₂e
          </span>
        </div>
        <div className="mt-2 text-[9px] font-mono uppercase tracking-widest text-zinc-400 flex flex-wrap gap-x-3 gap-y-1">
          <span>
            <span className="text-zinc-600">≈ </span>
            <span className="text-zinc-200">{offsetTonnes.toFixed(3)}</span> t
          </span>
          <span>
            <span className="text-zinc-600">est. </span>
            <span className="text-[#d8ffb0]">
              ${offsetCostMin.toFixed(2)}–${offsetCostMax.toFixed(2)}
            </span>
          </span>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onCopy('hero', offsetKg.toFixed(2))}
            className="btn-block btn-block-sm flex-1 justify-center"
            disabled={offsetKg <= 0}
          >
            {copiedKey === 'hero' ? (
              <>
                <Check size={10} />
                Copied
              </>
            ) : (
              <>
                <Copy size={10} />
                Copy {offsetKg.toFixed(2)} kg
              </>
            )}
          </button>
        </div>

        {expanded && (
          <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-500 mt-3 leading-relaxed">
            Mode {offsetMode} — pulled from{' '}
            <span className="text-zinc-300">
              {offsetMode === 'month'
                ? `${monthKg.toFixed(1)} kg this month`
                : offsetMode === 'total'
                ? `${totalKg.toFixed(1)} kg lifetime`
                : 'your custom value'}
            </span>
          </p>
        )}

        {offsetKg <= 0 && (
          <div className="mt-3 chip chip-warn !py-0.5 !px-1.5 !text-[8px] inline-flex">
            <AlertTriangle size={8} />
            Pick a target with kg &gt; 0
          </div>
        )}
      </div>
    </section>
  );
}

function ProviderGrid({
  offsetKg,
  offsetTonnes,
  copiedKey,
  onCopy
}: {
  offsetKg: number;
  offsetTonnes: number;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[9px] font-mono uppercase tracking-[0.28em] text-zinc-500">
          Verified providers
        </div>
        <span className="text-[8px] font-mono uppercase tracking-widest text-zinc-600">
          opens new tab
        </span>
      </div>
      <div className="space-y-2">
        {OFFSET_PROVIDERS.map((p) => {
          const Icon = OFFSET_ICON[p.iconKey];
          const minCost = (offsetTonnes * p.pricePerTonneUsd[0]).toFixed(2);
          const maxCost = (offsetTonnes * p.pricePerTonneUsd[1]).toFixed(2);
          const isCopied = copiedKey === `prov-${p.id}`;
          return (
            <div key={p.id} className="tile p-3 corner-mark">
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 border border-[var(--rule)] bg-[#0a110d] flex items-center justify-center shrink-0">
                  <Icon size={12} className="text-[#b6ff3c]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="display text-zinc-50 text-[13px] leading-tight">
                    {p.name}
                  </div>
                  <div className="text-[9px] font-mono text-zinc-500 mt-0.5 truncate">
                    {p.blurb}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                    $/t
                  </div>
                  <div className="text-[10px] font-mono text-zinc-300">
                    ${p.pricePerTonneUsd[0]}–${p.pricePerTonneUsd[1]}
                  </div>
                </div>
              </div>
              {offsetKg > 0 && (
                <div className="mt-2 flex items-center justify-between text-[9px] font-mono uppercase tracking-widest">
                  <span className="text-zinc-600">your est.</span>
                  <span className="text-[#b6ff3c]">
                    ${minCost}–${maxCost}
                  </span>
                </div>
              )}
              <div className="mt-2 flex items-center gap-1.5">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-block btn-block-sm flex-1 justify-center"
                >
                  Offset <ExternalLink size={10} />
                </a>
                <button
                  type="button"
                  onClick={() => onCopy(`prov-${p.id}`, offsetKg.toFixed(2))}
                  className="btn-block btn-block-sm"
                  disabled={offsetKg <= 0}
                  title={`Copy ${offsetKg.toFixed(2)} kg`}
                >
                  {isCopied ? <Check size={10} /> : <Copy size={10} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
