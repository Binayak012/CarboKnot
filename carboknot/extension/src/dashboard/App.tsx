import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  LineChart,
  Line
} from 'recharts';
import {
  Settings,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldCheck,
  ChevronRight,
  Activity,
  Package,
  MapPin,
  Eye,
  AlertTriangle,
  Zap,
  Cloud,
  HardDrive,
  Database,
  Radio,
  ScrollText,
  ArrowUpRight,
  Leaf,
  ExternalLink,
  Copy,
  Check,
  Sprout,
  Mountain,
  Globe,
  Trees
} from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/dashboard/components/ui/table';
import { useHistory } from '@/dashboard/hooks/useHistory';
import { useCacheStats } from '@/dashboard/hooks/useCacheStats';
import { useAuditLog } from '@/dashboard/hooks/useAuditLog';
import { TraceDrawer } from '@/dashboard/components/TraceDrawer';
import { SettingsModal } from '@/dashboard/components/SettingsModal';
import type { ViewRow, Trace } from '@/dashboard/lib/types';
import {
  formatRelativeTime,
  sourceBadgeLabel,
  getCategoryLabel,
  buildDailyTrend,
  buildCategoryTotals
} from '@/dashboard/lib/utils-dashboard';

/* =============================================================
   THEME CONSTANTS — acid-green editorial poster
   ============================================================= */

const ACID = '#b6ff3c';
const MONTHLY_BUDGET = 200;

/* =============================================================
   OFFSET PROVIDERS — vetted external services
   These are pure outbound links. No data leaves the extension:
   the user clicks, a new browser tab opens, and they handle
   the purchase entirely on the provider's site. We do NOT
   transmit kg figures anywhere — the user copies the number
   from the dashboard and pastes it into the provider's flow.
   Pricing is approximate market range as of 2026; treat it
   as a directional cost estimate, not a quote.
   ============================================================= */

type OffsetProvider = {
  id: string;
  name: string;
  tagline: string;
  blurb: string;
  approach: string;
  certification: string;
  pricePerTonneUsd: [number, number];
  url: string;
  iconKey: 'sprout' | 'mountain' | 'globe' | 'trees';
};

const OFFSET_PROVIDERS: OffsetProvider[] = [
  {
    id: 'cooleffect',
    name: 'Cool Effect',
    tagline: 'Direct project funding',
    blurb:
      'Buy verified offsets that fund specific climate projects. Highly transparent, every dollar traceable.',
    approach: 'Mixed portfolio',
    certification: 'Verra · Gold Standard',
    pricePerTonneUsd: [10, 15],
    url: 'https://www.cooleffect.org/buy-climate-solutions',
    iconKey: 'globe'
  },
  {
    id: 'goldstandard',
    name: 'Gold Standard Marketplace',
    tagline: 'Premium verified credits',
    blurb:
      'Browse projects backed by the strongest certification standard in the industry. Higher cost, higher rigor.',
    approach: 'Avoidance + removal',
    certification: 'Gold Standard',
    pricePerTonneUsd: [20, 30],
    url: 'https://marketplace.goldstandard.org/collections/projects',
    iconKey: 'trees'
  },
  {
    id: 'undo',
    name: 'UNDO',
    tagline: 'Permanent removal',
    blurb:
      'Enhanced rock weathering — spreads basalt on farmland to lock CO₂ into stone for thousands of years.',
    approach: 'Engineered removal',
    certification: 'Puro.earth · ICVCM-aligned',
    pricePerTonneUsd: [180, 250],
    url: 'https://un-do.com/buy-co2-removal',
    iconKey: 'mountain'
  },
  {
    id: 'myclimate',
    name: 'myclimate',
    tagline: 'Calculator-based',
    blurb:
      'Swiss non-profit. Enter your kg/tonnes directly into their portfolio calculator and select projects.',
    approach: 'Mixed portfolio',
    certification: 'Gold Standard · Plan Vivo',
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

type OffsetMode = 'month' | 'excess' | 'total' | 'product' | 'custom';

const OFFSET_MODES: { id: OffsetMode; label: string; hint: string }[] = [
  { id: 'month', label: 'This month', hint: 'Confirmed kg in current month' },
  { id: 'excess', label: 'Over budget', hint: 'Only what exceeds your cap' },
  { id: 'total', label: 'Lifetime', hint: 'All confirmed kg on file' },
  { id: 'product', label: 'Per product', hint: 'Pick a confirmed purchase' },
  { id: 'custom', label: 'Custom', hint: 'Enter any number of kg' }
];

const SOURCE_COLOR: Record<string, string> = {
  climatiq_fresh: ACID,
  climatiq_cached: '#5fa8d3',
  local_fallback: '#7d8a82'
};

const SOURCE_BADGE_CLASS: Record<string, string> = {
  climatiq_fresh:
    'border-[rgba(182,255,60,0.45)] text-[#d8ffb0] bg-[rgba(182,255,60,0.06)]',
  climatiq_cached: 'border-sky-700/50 text-sky-300 bg-sky-950/40',
  local_fallback: 'border-zinc-600/40 text-zinc-400 bg-zinc-800/40'
};

const MERCHANT_COLORS: Record<string, string> = {
  amazon: 'border-amber-700/40 text-amber-300 bg-amber-950/30',
  ebay: 'border-blue-700/40 text-blue-300 bg-blue-950/30',
  walmart: 'border-sky-700/40 text-sky-300 bg-sky-950/30',
  target: 'border-red-700/40 text-red-300 bg-red-950/30',
  bestbuy: 'border-yellow-700/40 text-yellow-300 bg-yellow-950/30'
};

const SECTIONS = [
  { id: 'trend', code: '01', label: 'Trend' },
  { id: 'budget', code: '02', label: 'Budget' },
  { id: 'offset', code: '03', label: 'Offset' },
  { id: 'categories', code: '04', label: 'Categories' },
  { id: 'recent', code: '05', label: 'Recent' },
  { id: 'privacy', code: '06', label: 'Privacy' },
  { id: 'activity', code: '07', label: 'Activity' },
  { id: 'methodology', code: '08', label: 'Method' }
] as const;

const AUDIT_EVENT_LABEL: Record<string, string> = {
  view_logged: 'Product view',
  swarm_status_refreshed: 'Swarm status',
  k2_reason_viewed: 'K2 footprint narration',
  alternative_rationale_viewed: 'Alternative rationale',
  reset_all: 'Local data reset'
};

const AUDIT_EVENT_COLOR: Record<string, string> = {
  view_logged:
    'border-zinc-700/50 text-zinc-300 bg-zinc-800/40',
  swarm_status_refreshed:
    'border-sky-700/50 text-sky-300 bg-sky-950/40',
  k2_reason_viewed:
    'border-[rgba(182,255,60,0.45)] text-[#d8ffb0] bg-[rgba(182,255,60,0.06)]',
  alternative_rationale_viewed:
    'border-[rgba(182,255,60,0.35)] text-[#c7f88a] bg-[rgba(182,255,60,0.04)]',
  reset_all: 'border-rose-700/40 text-rose-300 bg-rose-950/30'
};

/* =============================================================
   HELPERS — preserved from the original carboknot logic
   ============================================================= */

function getMethodologyVersion(rows: ViewRow[]): string {
  for (const row of rows) {
    try {
      const t = JSON.parse(row.trace) as Trace;
      if (t.methodology_version) return t.methodology_version;
    } catch {
      /* skip */
    }
  }
  return 'v2.4.1';
}

function describeAuditDetails(
  eventType: string,
  details?: Record<string, unknown>
): string {
  if (!details || typeof details !== 'object') return '—';
  const d = details as Record<string, unknown>;
  if (eventType === 'k2_reason_viewed') {
    const src = String(d.source ?? '');
    if (src === 'k2_think_v2') return 'source: K2 Think V2';
    if (src === 'fallback') return 'source: fallback';
    return src ? `source: ${src}` : '—';
  }
  if (eventType === 'swarm_status_refreshed') {
    if (d.ok === true) return `refreshed · ${d.category_count ?? 0} categories`;
    if (d.ok === false) return `fallback · ${d.reason ?? 'error'}`;
    return '—';
  }
  if (eventType === 'view_logged') {
    const merchant = d.merchant ? String(d.merchant) : '';
    const kg = typeof d.kg_total === 'number' ? `${d.kg_total.toFixed(1)} kg` : '';
    return [merchant, kg].filter(Boolean).join(' · ') || '—';
  }
  return '—';
}

function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const lastTarget = useRef<number | null>(null);
  useEffect(() => {
    if (lastTarget.current === target) return;
    lastTarget.current = target;
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

/* =============================================================
   PRESENTATION ATOMS — poster styling
   ============================================================= */

function Sparkline({
  data,
  color = ACID,
  height = 32
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.6}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

const CustomTooltip = ({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-[rgba(182,255,60,0.45)] bg-[#04080a]/95 px-3 py-2 text-xs shadow-2xl">
      <div className="text-zinc-500 mb-1 font-mono uppercase tracking-widest text-[9px]">
        {label}
      </div>
      <div className="font-bold text-[#d8ffb0] font-mono">
        {payload[0].value.toFixed(1)} kg CO₂e
      </div>
    </div>
  );
};

function PosterHeader({
  index,
  kicker,
  title,
  hint
}: {
  index: string;
  kicker: string;
  title: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-6 flex-wrap">
      <div className="flex items-end gap-5">
        <div className="display-mono text-[64px] md:text-[88px] text-[#0f1a14] leading-[0.8] select-none">
          {index}
        </div>
        <div>
          <div className="eyebrow-acid mb-2">{kicker}</div>
          <h2 className="display text-zinc-50 text-[34px] md:text-[52px]">
            {title}
          </h2>
        </div>
      </div>
      {hint && <div className="eyebrow text-right">{hint}</div>}
    </div>
  );
}

function MicroStat({
  label,
  value,
  sub,
  icon,
  acid,
  trend,
  sparkData
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  acid?: boolean;
  trend?: { value: number };
  sparkData?: number[];
}) {
  return (
    <div className={`tile px-5 py-5 corner-mark ${acid ? 'tile-acid' : ''}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="eyebrow">{label}</div>
        <div className={acid ? 'text-[#b6ff3c]' : 'text-zinc-600'}>{icon}</div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div
          className={`display-mono text-[32px] ${
            acid ? 'text-[#d8ffb0] acid-glow' : 'text-zinc-50'
          }`}
        >
          {value}
        </div>
        {trend && (
          <div
            className={`flex items-center gap-1 text-[10px] font-mono mb-1 ${
              trend.value > 0
                ? 'text-rose-400'
                : trend.value < 0
                ? 'text-[#b6ff3c]'
                : 'text-zinc-500'
            }`}
          >
            {trend.value > 0 ? (
              <TrendingUp size={11} />
            ) : trend.value < 0 ? (
              <TrendingDown size={11} />
            ) : (
              <Minus size={11} />
            )}
            {Math.abs(trend.value).toFixed(0)}%
          </div>
        )}
      </div>
      {sub && (
        <div className="text-[10px] text-zinc-500 mt-2 font-mono uppercase tracking-widest">
          {sub}
        </div>
      )}
      {sparkData && sparkData.length > 1 && (
        <div className="mt-3 -mx-1 opacity-90">
          <Sparkline data={sparkData} color={acid ? ACID : '#52525b'} height={28} />
        </div>
      )}
    </div>
  );
}

function ModeReadout({
  label,
  value,
  sub
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
        {label}
      </div>
      <div className="display-mono text-zinc-100 text-[28px] leading-none">
        {value}
      </div>
      {sub && (
        <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mt-2">
          {sub}
        </div>
      )}
    </div>
  );
}

/* =============================================================
   APP
   ============================================================= */

type SortKey = 'ts' | 'kg_total' | 'merchant';
type SortDir = 'asc' | 'desc';

export default function App() {
  // ------------------------------------------------------------------
  // DATA — exact same hooks as the previous dashboard. These remain the
  // contract with the extension's storage layer (Dexie + chrome.storage).
  // ------------------------------------------------------------------
  const {
    rows,
    loading: historyLoading,
    isSeed: historyIsSeed
  } = useHistory();
  const { stats: cacheStats } = useCacheStats();
  const { rows: auditRows, isSeed: auditIsSeed } = useAuditLog(25);
  const showingDemoData = historyIsSeed || auditIsSeed;

  const [selectedRow, setSelectedRow] = useState<ViewRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('ts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterMerchant, setFilterMerchant] = useState<string>('all');
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'area' | 'bar'>('area');
  const [filterType, setFilterType] = useState<'all' | 'confirmed' | 'browsing'>('all');

  // Offset section — pure UI state, never transmitted anywhere.
  const [offsetMode, setOffsetMode] = useState<OffsetMode>('month');
  const [offsetCustomKg, setOffsetCustomKg] = useState<string>('25');
  const [offsetProductId, setOffsetProductId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [dockVisible, setDockVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('trend');

  const methodologyVersion = useMemo(() => getMethodologyVersion(rows), [rows]);

  // Carboknot-specific split: confirmed purchases vs browsing-only views.
  // Totals/budgets/week deltas count CONFIRMED rows only — same as before.
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
  const viewedKg = useMemo(
    () => viewedRows.reduce((s, r) => s + r.kg_total, 0),
    [viewedRows]
  );
  const totalCi = (totalCiHigh - totalCiLow) / 2;
  const milesDriven = Math.round(totalKg * 2.5);

  const trendData = useMemo(() => buildDailyTrend(rows), [rows]);
  const last7TrendValues = useMemo(
    () => trendData.slice(-7).map((d) => d.kg),
    [trendData]
  );
  const categoryTotals = useMemo(() => buildCategoryTotals(rows), [rows]);
  const top5Categories = categoryTotals.slice(0, 5);
  const maxCatKg = top5Categories[0]?.kg ?? 1;

  const now = Date.now();
  const DAY = 86400000;
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
  const radialData = [{ name: 'used', value: budgetPct, fill: budgetColor }];

  // ----- Offset calculations -----
  const offsetExcessKg = Math.max(0, monthKg - MONTHLY_BUDGET);
  const offsetProductRow = useMemo(
    () => purchasedRows.find((r) => r.id === offsetProductId) ?? null,
    [purchasedRows, offsetProductId]
  );
  const offsetCustomNum = useMemo(() => {
    const n = parseFloat(offsetCustomKg);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [offsetCustomKg]);
  const offsetKg = useMemo(() => {
    switch (offsetMode) {
      case 'month':
        return monthKg;
      case 'excess':
        return offsetExcessKg;
      case 'total':
        return totalKg;
      case 'product':
        return offsetProductRow?.kg_total ?? 0;
      case 'custom':
        return offsetCustomNum;
      default:
        return 0;
    }
  }, [offsetMode, monthKg, offsetExcessKg, totalKg, offsetProductRow, offsetCustomNum]);
  const offsetTonnes = offsetKg / 1000;
  const offsetCostMin = offsetTonnes * Math.min(...OFFSET_PROVIDERS.map((p) => p.pricePerTonneUsd[0]));
  const offsetCostMax = offsetTonnes * Math.max(...OFFSET_PROVIDERS.map((p) => p.pricePerTonneUsd[1]));
  const offsetActiveLabel =
    OFFSET_MODES.find((m) => m.id === offsetMode)?.label ?? '—';

  const handleCopyKg = useCallback(
    async (key: string, value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopiedKey(key);
        setTimeout(() => {
          setCopiedKey((curr) => (curr === key ? null : curr));
        }, 1600);
      } catch {
        // Older browsers / restricted contexts — silently no-op. The user
        // can still read the number on screen and type it in.
      }
    },
    []
  );

  const handleOffsetProduct = useCallback((row: ViewRow) => {
    setOffsetMode('product');
    setOffsetProductId(row.id);
    setSelectedRow(null);
    requestAnimationFrame(() => {
      const el = document.getElementById('offset');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const sourceTotals = useMemo(() => {
    const map: Record<string, number> = {
      climatiq_fresh: 0,
      climatiq_cached: 0,
      local_fallback: 0
    };
    rows.forEach((r) => {
      map[r.data_source] = (map[r.data_source] ?? 0) + 1;
    });
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .map(([key, value]) => ({
        name: sourceBadgeLabel(key),
        key,
        value,
        fill: SOURCE_COLOR[key] ?? '#a3a3a3'
      }));
  }, [rows]);

  const localPct = useMemo(() => {
    const local = rows.filter(
      (r) => r.data_source === 'climatiq_cached' || r.data_source === 'local_fallback'
    ).length;
    return rows.length > 0 ? Math.round((local / rows.length) * 100) : 0;
  }, [rows]);

  const topCat = top5Categories[0];
  const heaviestRow = useMemo(
    () => [...rows].sort((a, b) => b.kg_total - a.kg_total)[0],
    [rows]
  );
  const lightestRow = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.kg_total - b.kg_total)
        .find((r) => r.kg_total > 0),
    [rows]
  );
  const uncertainCount = useMemo(
    () => rows.filter((r) => r.category_uncertain).length,
    [rows]
  );

  const merchants = useMemo(
    () => ['all', ...Array.from(new Set(rows.map((r) => r.merchant)))],
    [rows]
  );

  const sortedRows = useMemo(() => {
    const byType =
      filterType === 'confirmed'
        ? rows.filter((r) => r.purchased)
        : filterType === 'browsing'
        ? rows.filter((r) => !r.purchased)
        : rows;
    const filtered =
      filterMerchant === 'all'
        ? byType
        : byType.filter((r) => r.merchant === filterMerchant);
    return [...filtered].sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sortKey === 'ts') {
        av = a.ts;
        bv = b.ts;
      } else if (sortKey === 'kg_total') {
        av = a.kg_total;
        bv = b.kg_total;
      } else {
        av = a.merchant;
        bv = b.merchant;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortKey, sortDir, filterMerchant, filterType]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <Minus size={10} className="text-zinc-700" />;
    return sortDir === 'desc' ? (
      <TrendingDown size={10} className="text-[#b6ff3c]" />
    ) : (
      <TrendingUp size={10} className="text-[#b6ff3c]" />
    );
  };

  const animatedTotal = useCountUp(totalKg, 1400);
  const animatedMonth = useCountUp(monthKg, 1400);

  // ------------------------------------------------------------------
  // BOTTOM DOCK NAV — appears once the user scrolls past the hero band.
  // ------------------------------------------------------------------
  useEffect(() => {
    const onScroll = () => setDockVisible(window.scrollY > 380);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => !!el
    );
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.1, 0.3, 0.6] }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }, []);

  // ------------------------------------------------------------------
  // LOADING STATE — first read of the local Dexie DB has not finished.
  // ------------------------------------------------------------------
  if (historyLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500 font-mono text-sm grid-bg">
        <span className="inline-flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 bg-[#b6ff3c] pulse-acid"
            aria-hidden="true"
          />
          Loading local history…
        </span>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // EMPTY STATE — only ever reached inside the real extension. The
  // standalone preview always falls back to seed and never lands here.
  // ------------------------------------------------------------------
  if (rows.length === 0) {
    return (
      <div className="min-h-screen text-zinc-100 grid-bg relative pb-32">
        <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[1400px] h-[700px] bg-[#b6ff3c]/[0.05] blur-[160px] rounded-full" />

        <main className="max-w-[920px] mx-auto px-6 md:px-10 pt-10 md:pt-16 relative z-10">
          <div className="flex items-center gap-2 mb-8 text-[11px] font-mono uppercase tracking-widest text-zinc-500">
            <span className="w-1.5 h-1.5 bg-[#b6ff3c] pulse-acid" />
            Carboknot · local-first · {methodologyVersion}
            <div className="flex-1 ring-divider" />
            <button
              onClick={() => setSettingsOpen(true)}
              className="btn-block btn-block-sm"
            >
              <Settings size={11} />
              Settings
            </button>
          </div>

          <div className="tile-acid p-8 md:p-12 corner-mark relative overflow-hidden">
            <div className="pointer-events-none absolute -right-20 -top-20 w-72 h-72 bg-[#b6ff3c]/10 blur-3xl rounded-full" />
            <div className="relative">
              <div className="stencil text-[10px] text-[#b6ff3c] mb-4">
                NO DATA YET
              </div>
              <h1 className="display text-zinc-50 text-[36px] md:text-[56px] leading-[0.95] tracking-tight mb-4">
                Browse a product to start
                <br />
                tracking your footprint.
              </h1>
              <p className="text-zinc-400 text-sm md:text-base leading-relaxed max-w-[60ch] font-mono">
                Carboknot computes your carbon estimate the moment you open a
                product page on a supported merchant. Nothing is shown here
                because nothing has been logged yet — your local database is
                empty.
              </p>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href="https://www.amazon.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tile p-5 corner-mark hover:border-[rgba(182,255,60,0.35)] transition-colors group"
                >
                  <div className="eyebrow mb-2">Try it on</div>
                  <div className="display text-zinc-100 text-[20px] flex items-center justify-between">
                    Amazon
                    <ArrowUpRight
                      size={16}
                      className="text-zinc-600 group-hover:text-[#b6ff3c] transition-colors"
                    />
                  </div>
                </a>
                <a
                  href="https://www.ebay.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tile p-5 corner-mark hover:border-[rgba(182,255,60,0.35)] transition-colors group"
                >
                  <div className="eyebrow mb-2">Try it on</div>
                  <div className="display text-zinc-100 text-[20px] flex items-center justify-between">
                    eBay
                    <ArrowUpRight
                      size={16}
                      className="text-zinc-600 group-hover:text-[#b6ff3c] transition-colors"
                    />
                  </div>
                </a>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="tile p-5 corner-mark">
              <div className="eyebrow mb-2">01 · Browse</div>
              <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                Open any product page on Amazon or eBay. The badge appears in
                the corner with a kg estimate.
              </p>
            </div>
            <div className="tile p-5 corner-mark">
              <div className="eyebrow mb-2">02 · Log</div>
              <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                The view is appended to your local Dexie DB. No request leaves
                your machine other than to Climatiq.
              </p>
            </div>
            <div className="tile p-5 corner-mark">
              <div className="eyebrow mb-2">03 · Reflect</div>
              <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                Reload this dashboard. Trend, budget, categories, audit ledger
                — all populated from your real data.
              </p>
            </div>
          </div>

          <div className="mt-8 text-[10px] font-mono uppercase tracking-widest text-zinc-600 text-center">
            local-first · zero telemetry · open source
          </div>
        </main>

        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          methodologyVersion={methodologyVersion}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-zinc-100 grid-bg relative pb-32">
      {/* Decorative backplate */}
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[1400px] h-[700px] bg-[#b6ff3c]/[0.05] blur-[160px] rounded-full" />

      <main className="max-w-[1280px] mx-auto px-6 md:px-10 pt-6 md:pt-10 relative z-10 space-y-8 md:space-y-12">

        {/* ============================================================
            MARKETING STRIP — thin announcement band (Source / Install)
           ============================================================ */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
          {showingDemoData ? (
            <span
              className="chip"
              style={{
                borderColor: 'rgba(251, 191, 36, 0.45)',
                color: '#fcd34d',
                background: 'rgba(251, 191, 36, 0.06)'
              }}
              title="Standalone preview — your local DB is empty so demo rows are shown. Real Dexie data always wins inside the extension."
            >
              <AlertTriangle size={9} />
              DEMO · PREVIEW DATA
            </span>
          ) : (
            <span className="chip chip-acid">
              <span className="w-1.5 h-1.5 rounded-full bg-[#b6ff3c] tick" />
              LIVE · LOCAL DATA
            </span>
          )}
          <span className="chip">BETA · v0.1</span>
          <span className="hidden md:inline text-[#4a5550] uppercase tracking-widest">
            Browser extension that prints a carbon receipt at checkout
          </span>
          <div className="flex-1" />
          <a
            href="https://github.com/Binayak012/CarboKnot"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-block"
          >
            Source <ArrowUpRight size={12} />
          </a>
          <a
            href="https://github.com/Binayak012/CarboKnot"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-block btn-block-active"
          >
            Install Extension <ArrowUpRight size={12} />
          </a>
        </div>

        {/* ============================================================
            HERO BAND — wordmark + monolith total + settings
           ============================================================ */}
        <section className="fade-in-up">
          <div className="grid grid-cols-12 gap-3 md:gap-4">
            {/* Wordmark tile */}
            <div className="col-span-12 md:col-span-4 tile px-6 py-5 corner-mark flex items-center justify-between">
              <div>
                <div className="display text-[44px] md:text-[56px] text-zinc-50 leading-none tracking-[-0.06em]">
                  CARBO
                  <span className="text-[#b6ff3c]">/</span>
                  KNOT
                </div>
                <div className="eyebrow mt-3">data‑first carbon receipt</div>
              </div>
              <div className="hidden md:flex flex-col items-end gap-2">
                <div className="w-2 h-2 rounded-full bg-[#b6ff3c] pulse-acid" />
                <div className="stencil text-[9px] text-[#b6ff3c]">REC</div>
              </div>
            </div>

            {/* Monolith hero — TOTAL CONFIRMED CO₂e */}
            <div className="col-span-12 md:col-span-6 tile-hero p-6 md:p-8 corner-mark relative overflow-hidden">
              <div className="absolute inset-0 hatch opacity-60 pointer-events-none" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <div className="eyebrow-acid">A · Confirmed Footprint</div>
                  <div className="chip chip-acid">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#b6ff3c] tick" />
                    Live · last 30d
                  </div>
                </div>
                <div className="mt-4 flex items-end gap-3">
                  <div className="display text-[#d8ffb0] acid-glow leading-[0.78] text-[110px] md:text-[180px]">
                    {animatedTotal.toFixed(1)}
                  </div>
                  <div className="pb-3 md:pb-6">
                    <div className="display-mono text-[#b6ff3c] text-[24px] md:text-[32px]">
                      kg
                    </div>
                    <div className="eyebrow mt-1">CO₂e</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] font-mono text-[#7d8a82]">
                  <span>± {totalCi.toFixed(1)} kg confidence interval</span>
                  <span className="text-[#3a4540]">/</span>
                  <span>≈ {milesDriven.toLocaleString()} mi driven equivalent</span>
                  <span className="text-[#3a4540]">/</span>
                  <span>{purchasedRows.length} confirmed · {viewedRows.length} browsing</span>
                </div>
              </div>
            </div>

            {/* Settings + meta tile */}
            <div className="col-span-12 md:col-span-2 flex flex-col gap-3 md:gap-4">
              <button
                onClick={() => setSettingsOpen(true)}
                className="tile flex-1 px-4 py-4 group flex flex-col items-start justify-between text-left hover:border-[rgba(182,255,60,0.4)] transition-colors"
                aria-label="Settings"
              >
                <Settings
                  size={18}
                  className="text-zinc-500 group-hover:text-[#b6ff3c] group-hover:rotate-45 transition-all duration-300"
                />
                <div>
                  <div className="stencil text-[10px] text-zinc-500 group-hover:text-[#d8ffb0]">
                    System
                  </div>
                  <div className="text-zinc-200 font-mono text-[13px] mt-0.5">
                    Settings
                  </div>
                </div>
              </button>
              <div className="tile-flat px-4 py-3">
                <div className="stencil text-[9px] text-zinc-500">Method</div>
                <div className="display-mono text-[#b6ff3c] text-[18px] mt-1">
                  {methodologyVersion}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 01 — TREND
           ============================================================ */}
        <section id="trend" className="fade-in-up fade-in-up-delay-1 scroll-mt-8">
          <PosterHeader
            index="01"
            kicker="Daily emission curve"
            title="Carbon Trend"
            hint={
              <>
                {trendData.length} days · {chartMode.toUpperCase()} mode
              </>
            }
          />

          <div className="grid grid-cols-12 gap-3 md:gap-4">
            {/* Big chart tile */}
            <div className="col-span-12 lg:col-span-8 tile p-6 md:p-7">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="eyebrow">This week</div>
                  <div className="flex items-end gap-3 mt-2">
                    <div className="display-mono text-zinc-50 text-[40px]">
                      {thisWeekKg.toFixed(1)}
                    </div>
                    <div
                      className={`pb-2 flex items-center gap-1 font-mono text-[11px] ${
                        weekDelta > 0
                          ? 'text-rose-400'
                          : weekDelta < 0
                          ? 'text-[#b6ff3c]'
                          : 'text-zinc-500'
                      }`}
                    >
                      {weekDelta > 0 ? (
                        <TrendingUp size={12} />
                      ) : weekDelta < 0 ? (
                        <TrendingDown size={12} />
                      ) : (
                        <Minus size={12} />
                      )}
                      {Math.abs(weekDelta).toFixed(0)}% vs last
                    </div>
                  </div>
                </div>
                <div className="flex">
                  <button
                    onClick={() => setChartMode('area')}
                    className={`btn-block ${chartMode === 'area' ? 'btn-block-active' : ''}`}
                  >
                    Area
                  </button>
                  <button
                    onClick={() => setChartMode('bar')}
                    className={`btn-block -ml-px ${chartMode === 'bar' ? 'btn-block-active' : ''}`}
                  >
                    Bar
                  </button>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                {chartMode === 'area' ? (
                  <AreaChart
                    data={trendData}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="kgGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ACID} stopOpacity={0.55} />
                        <stop offset="60%" stopColor={ACID} stopOpacity={0.1} />
                        <stop offset="100%" stopColor={ACID} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="2 4"
                      stroke="#15201a"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#52525b', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval={4}
                      tickFormatter={(v: string) => {
                        const d = new Date(v + 'T00:00:00');
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      }}
                    />
                    <YAxis
                      tick={{ fill: '#52525b', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="kg"
                      stroke={ACID}
                      strokeWidth={2.4}
                      fill="url(#kgGrad)"
                      dot={false}
                      activeDot={{
                        r: 5,
                        fill: ACID,
                        stroke: '#04080a',
                        strokeWidth: 3
                      }}
                    />
                  </AreaChart>
                ) : (
                  <BarChart
                    data={trendData}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="2 4"
                      stroke="#15201a"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#52525b', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval={4}
                      tickFormatter={(v: string) => {
                        const d = new Date(v + 'T00:00:00');
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      }}
                    />
                    <YAxis
                      tick={{ fill: '#52525b', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="kg">
                      {trendData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.kg > 0 ? ACID : '#15201a'}
                          opacity={entry.kg > 0 ? 0.95 : 0.4}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Stat micro-tiles stack — preserves the carboknot KPIs */}
            <div className="col-span-12 lg:col-span-4 grid grid-cols-2 lg:grid-cols-1 gap-3 md:gap-4">
              <MicroStat
                label="Confirmed CO₂e"
                value={`${totalKg.toFixed(1)} kg`}
                sub={`${viewedKg.toFixed(1)} kg browsed, not counted`}
                icon={<Activity size={14} />}
                acid
                trend={{ value: weekDelta }}
                sparkData={last7TrendValues}
              />
              <MicroStat
                label="Miles driven"
                value={milesDriven.toLocaleString()}
                sub="0.4 kg per mi (US avg)"
                icon={<MapPin size={14} />}
              />
              <MicroStat
                label="Confirmed buys"
                value={String(purchasedRows.length)}
                sub={
                  viewedRows.length > 0
                    ? `${viewedRows.length} awaiting confirmation`
                    : uncertainCount > 0
                    ? `${uncertainCount} uncertain`
                    : 'all categorized'
                }
                icon={<Package size={14} />}
              />
              <MicroStat
                label="Local‑first ratio"
                value={`${localPct}%`}
                sub={`${cacheStats.hit_count_session} cache hits this session`}
                icon={<HardDrive size={14} />}
              />
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 02 — BUDGET
           ============================================================ */}
        <section id="budget" className="fade-in-up fade-in-up-delay-2 scroll-mt-8">
          <PosterHeader
            index="02"
            kicker="Monthly carbon target"
            title="Budget"
            hint={
              <>
                {monthKg.toFixed(0)} of {MONTHLY_BUDGET} kg this month
              </>
            }
          />

          <div className="grid grid-cols-12 gap-3 md:gap-4">
            {/* Hero radial */}
            <div className="col-span-12 md:col-span-7 tile-hero p-8 md:p-10 corner-mark relative overflow-hidden">
              <div className="absolute inset-0 hatch opacity-40 pointer-events-none" />
              <div className="relative grid grid-cols-12 gap-6 items-center">
                <div className="col-span-12 sm:col-span-7">
                  <div className="eyebrow-acid mb-3">Cap usage</div>
                  <div className="display text-zinc-50 leading-[0.78] text-[88px] md:text-[140px]">
                    {budgetPct.toFixed(0)}
                    <span className="text-[#b6ff3c]">%</span>
                  </div>
                  <div className="mt-3 font-mono text-[11px] text-[#7d8a82] uppercase tracking-widest">
                    of {MONTHLY_BUDGET} kg cap (confirmed only)
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <div className="tile-flat px-4 py-3">
                      <div className="stencil text-[9px] text-zinc-500">Used</div>
                      <div className="display-mono text-zinc-50 text-[24px] mt-1">
                        {animatedMonth.toFixed(0)}
                        <span className="text-zinc-500 text-[14px] ml-1">kg</span>
                      </div>
                    </div>
                    <div className="tile-flat px-4 py-3">
                      <div className="stencil text-[9px] text-zinc-500">Remaining</div>
                      <div
                        className="display-mono text-[24px] mt-1"
                        style={{ color: budgetColor }}
                      >
                        {Math.max(0, MONTHLY_BUDGET - monthKg).toFixed(0)}
                        <span className="text-zinc-500 text-[14px] ml-1">kg</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-span-12 sm:col-span-5 flex justify-center">
                  <div className="relative glow-ring">
                    <RadialBarChart
                      width={220}
                      height={220}
                      cx={110}
                      cy={110}
                      innerRadius={80}
                      outerRadius={104}
                      data={radialData}
                      startAngle={90}
                      endAngle={-270}
                      barSize={20}
                    >
                      <PolarAngleAxis
                        type="number"
                        domain={[0, 100]}
                        angleAxisId={0}
                        tick={false}
                      />
                      <RadialBar
                        background={{ fill: '#0d1612' }}
                        dataKey="value"
                        cornerRadius={0}
                        fill={budgetColor}
                        angleAxisId={0}
                      />
                    </RadialBarChart>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="display-mono text-zinc-50 text-[40px]">
                        {monthKg.toFixed(0)}
                      </span>
                      <span className="stencil text-[9px] text-zinc-500 mt-1">
                        kg this mo.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Insights stack */}
            <div className="col-span-12 md:col-span-5 grid grid-cols-1 gap-3 md:gap-4">
              <div className="tile px-5 py-5 corner-mark">
                <div className="flex items-center justify-between mb-4">
                  <div className="eyebrow">Top emitter</div>
                  <ArrowUpRight size={14} className="text-[#b6ff3c]" />
                </div>
                {topCat ? (
                  <>
                    <div className="display text-zinc-50 text-[28px] md:text-[34px] leading-tight">
                      {getCategoryLabel(topCat.category)}
                    </div>
                    <div className="mt-3 flex items-center gap-3 font-mono text-[11px]">
                      <span className="display-mono text-[#b6ff3c] text-[20px]">
                        {topCat.kg.toFixed(0)} kg
                      </span>
                      <span className="text-zinc-600">
                        {totalKg > 0
                          ? Math.round((topCat.kg / Math.max(totalKg, 1)) * 100)
                          : 0}
                        % of confirmed total
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-zinc-500 text-sm">No data yet</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 md:gap-4">
                <div className="tile px-4 py-4 corner-mark">
                  <div className="eyebrow">Heaviest</div>
                  {heaviestRow ? (
                    <>
                      <div className="display-mono text-zinc-50 text-[22px] mt-2">
                        {heaviestRow.kg_total.toFixed(0)}
                        <span className="text-zinc-500 text-[12px] ml-1">kg</span>
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-2 truncate font-mono">
                        {heaviestRow.title}
                      </div>
                    </>
                  ) : (
                    <div className="text-zinc-500 text-xs mt-2">—</div>
                  )}
                </div>
                <div className="tile px-4 py-4 corner-mark">
                  <div className="eyebrow">Lightest</div>
                  {lightestRow ? (
                    <>
                      <div className="display-mono text-zinc-50 text-[22px] mt-2">
                        {lightestRow.kg_total.toFixed(1)}
                        <span className="text-zinc-500 text-[12px] ml-1">kg</span>
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-2 font-mono">
                        {getCategoryLabel(lightestRow.category)}
                      </div>
                    </>
                  ) : (
                    <div className="text-zinc-500 text-xs mt-2">—</div>
                  )}
                </div>
              </div>

              <div className="tile px-5 py-4 corner-mark flex items-center justify-between">
                <div>
                  <div className="eyebrow">Monthly pace</div>
                  <div className="display-mono text-zinc-50 text-[20px] mt-1">
                    {monthKg.toFixed(0)} <span className="text-zinc-600">/</span>{' '}
                    {MONTHLY_BUDGET}
                    <span className="text-zinc-500 text-[12px] ml-1">kg</span>
                  </div>
                </div>
                <div className="w-32 h-2 bg-[#0d1612] relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{
                      width: `${budgetPct}%`,
                      backgroundColor: budgetColor,
                      boxShadow: `0 0 12px ${budgetColor}`
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 03 — OFFSET
              Pure outbound. No data transmitted. The user picks a kg
              amount (defaulting to current month), copies it to the
              clipboard, and is sent to a vetted external provider in
              a new tab. Acts as a do-something CTA after the budget.
           ============================================================ */}
        <section id="offset" className="fade-in-up fade-in-up-delay-2 scroll-mt-8">
          <PosterHeader
            index="03"
            kicker="Make it right"
            title="Carbon Offset"
            hint={
              <>
                {OFFSET_PROVIDERS.length} vetted providers
                <span className="mx-2 text-zinc-700">·</span>
                opens in new tab
              </>
            }
          />

          <div className="grid grid-cols-12 gap-3 md:gap-4">
            {/* Hero — kg + cost band */}
            <div className="col-span-12 lg:col-span-7 tile-acid p-6 md:p-8 corner-mark relative overflow-hidden">
              <div className="pointer-events-none absolute -right-16 -top-16 w-72 h-72 bg-[#b6ff3c]/10 blur-3xl rounded-full" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-4">
                  <Leaf size={14} className="text-[#b6ff3c]" />
                  <span className="stencil text-[10px] text-[#b6ff3c]">
                    OFFSET TARGET · {offsetActiveLabel.toUpperCase()}
                  </span>
                </div>

                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="display-mono text-[#b6ff3c] text-[64px] md:text-[88px] leading-none tracking-tight">
                    {offsetKg.toFixed(offsetKg < 10 ? 1 : 0)}
                  </span>
                  <span className="display text-zinc-300 text-[20px] md:text-[24px]">
                    kg CO₂e
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-mono uppercase tracking-widest text-zinc-400">
                  <span>
                    <span className="text-zinc-600">≈ </span>
                    <span className="text-zinc-200">{offsetTonnes.toFixed(3)}</span> t
                  </span>
                  <span>
                    <span className="text-zinc-600">est. cost </span>
                    <span className="text-[#d8ffb0]">
                      ${offsetCostMin.toFixed(2)} – ${offsetCostMax.toFixed(2)}
                    </span>
                  </span>
                  <span>
                    <span className="text-zinc-600">market range </span>
                    <span className="text-zinc-300">$10 – $250 /t</span>
                  </span>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyKg('hero', offsetKg.toFixed(2))}
                    className="btn-block btn-block-sm"
                    disabled={offsetKg <= 0}
                  >
                    {copiedKey === 'hero' ? (
                      <>
                        <Check size={12} />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        Copy {offsetKg.toFixed(2)} kg
                      </>
                    )}
                  </button>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                    paste into provider checkout
                  </span>
                </div>

                {offsetKg <= 0 && (
                  <div className="mt-5 chip chip-warn inline-flex">
                    <AlertTriangle size={9} />
                    Pick a target with kg &gt; 0
                  </div>
                )}
              </div>
            </div>

            {/* Mode picker + per-mode controls */}
            <div className="col-span-12 lg:col-span-5 tile p-6 corner-mark space-y-4">
              <div className="eyebrow">Choose target</div>

              <div className="grid grid-cols-2 gap-1.5">
                {OFFSET_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setOffsetMode(m.id)}
                    className={`btn-block btn-block-sm justify-start ${
                      offsetMode === m.id ? 'btn-block-active' : ''
                    }`}
                    title={m.hint}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="border-t border-[var(--rule)] pt-4 space-y-3">
                {offsetMode === 'month' && (
                  <ModeReadout
                    label="Confirmed kg this month"
                    value={`${monthKg.toFixed(1)} kg`}
                    sub={`vs ${MONTHLY_BUDGET} kg cap · ${budgetPct.toFixed(0)}% used`}
                  />
                )}
                {offsetMode === 'excess' && (
                  <ModeReadout
                    label="Over your monthly cap"
                    value={`${offsetExcessKg.toFixed(1)} kg`}
                    sub={
                      offsetExcessKg > 0
                        ? `${monthKg.toFixed(0)} kg used · ${MONTHLY_BUDGET} kg budget`
                        : 'Under budget — nothing to offset here'
                    }
                  />
                )}
                {offsetMode === 'total' && (
                  <ModeReadout
                    label="All-time confirmed kg"
                    value={`${totalKg.toFixed(1)} kg`}
                    sub={`${purchasedRows.length} purchases on file`}
                  />
                )}
                {offsetMode === 'product' && (
                  <div className="space-y-2">
                    <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                      Pick a confirmed purchase
                    </label>
                    <select
                      value={offsetProductId ?? ''}
                      onChange={(e) =>
                        setOffsetProductId(e.target.value || null)
                      }
                      className="w-full bg-[#0a110d] border border-[var(--rule)] text-zinc-200 font-mono text-xs px-3 py-2 outline-none focus:border-[rgba(182,255,60,0.45)] hover:border-[rgba(182,255,60,0.25)] transition-colors"
                    >
                      <option value="">— select product —</option>
                      {purchasedRows.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.kg_total.toFixed(1)} kg · {r.title.slice(0, 60)}
                          {r.title.length > 60 ? '…' : ''}
                        </option>
                      ))}
                    </select>
                    {offsetProductRow && (
                      <div className="text-[11px] font-mono text-zinc-500 mt-1">
                        <span className="text-zinc-300">
                          {offsetProductRow.kg_total.toFixed(1)} kg
                        </span>
                        <span className="mx-2 text-zinc-700">·</span>
                        {getCategoryLabel(offsetProductRow.category)}
                        <span className="mx-2 text-zinc-700">·</span>$
                        {offsetProductRow.price_usd.toFixed(2)}
                      </div>
                    )}
                    {purchasedRows.length === 0 && (
                      <div className="text-[11px] font-mono text-zinc-600">
                        No confirmed purchases yet.
                      </div>
                    )}
                  </div>
                )}
                {offsetMode === 'custom' && (
                  <div className="space-y-2">
                    <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                      Enter kg CO₂e
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.1"
                        value={offsetCustomKg}
                        onChange={(e) => setOffsetCustomKg(e.target.value)}
                        className="w-full bg-[#0a110d] border border-[var(--rule)] text-zinc-100 display-mono text-[18px] px-3 py-2 outline-none focus:border-[rgba(182,255,60,0.45)] hover:border-[rgba(182,255,60,0.25)] transition-colors"
                        placeholder="25"
                      />
                      <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                        kg
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[10, 25, 50, 100, 250].map((preset) => (
                        <button
                          key={preset}
                          onClick={() => setOffsetCustomKg(String(preset))}
                          className="btn-block btn-block-sm"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Provider grid */}
            <div className="col-span-12 mt-2">
              <div className="flex items-center justify-between mb-3">
                <div className="eyebrow">Verified providers</div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                  external · not affiliated
                </span>
              </div>

              <div className="grid grid-cols-12 gap-3 md:gap-4">
                {OFFSET_PROVIDERS.map((p) => {
                  const Icon = OFFSET_ICON[p.iconKey];
                  const minCost = (offsetTonnes * p.pricePerTonneUsd[0]).toFixed(2);
                  const maxCost = (offsetTonnes * p.pricePerTonneUsd[1]).toFixed(2);
                  const isCopied = copiedKey === `prov-${p.id}`;
                  return (
                    <div
                      key={p.id}
                      className="col-span-12 sm:col-span-6 lg:col-span-3 tile p-5 corner-mark relative flex flex-col"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-9 h-9 border border-[var(--rule)] bg-[#0a110d] flex items-center justify-center">
                          <Icon size={16} className="text-[#b6ff3c]" />
                        </div>
                        <span className="chip">{p.certification}</span>
                      </div>

                      <div className="display text-zinc-50 text-[18px] leading-tight mb-1">
                        {p.name}
                      </div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-[#d8ffb0] mb-3">
                        {p.tagline}
                      </div>

                      <p className="text-xs text-zinc-400 leading-relaxed flex-1">
                        {p.blurb}
                      </p>

                      <div className="mt-4 pt-3 border-t border-[var(--rule)] space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                          <span className="text-zinc-600">approach</span>
                          <span className="text-zinc-300 normal-case tracking-normal">
                            {p.approach}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                          <span className="text-zinc-600">$ / tonne</span>
                          <span className="text-zinc-300">
                            ${p.pricePerTonneUsd[0]}–${p.pricePerTonneUsd[1]}
                          </span>
                        </div>
                        {offsetKg > 0 && (
                          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                            <span className="text-zinc-600">your est.</span>
                            <span className="text-[#b6ff3c]">
                              ${minCost}–${maxCost}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex items-center gap-1.5">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-block btn-block-sm flex-1 justify-center"
                        >
                          Offset
                          <ExternalLink size={11} />
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyKg(`prov-${p.id}`, offsetKg.toFixed(2))
                          }
                          className="btn-block btn-block-sm"
                          title={`Copy ${offsetKg.toFixed(2)} kg`}
                          disabled={offsetKg <= 0}
                        >
                          {isCopied ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 text-[10px] font-mono uppercase tracking-widest text-zinc-600 leading-relaxed">
                Carboknot does not transmit your kg figure to any provider.
                Pricing shown is an estimate based on public market rates and
                may differ at checkout. Choose providers that publish project
                IDs and third-party verification.
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 04 — CATEGORIES
           ============================================================ */}
        <section
          id="categories"
          className="fade-in-up fade-in-up-delay-3 scroll-mt-8"
        >
          <PosterHeader
            index="04"
            kicker="Carbon inventory"
            title="Top Categories"
            hint={`${categoryTotals.length} categories on file`}
          />

          <div className="grid grid-cols-12 gap-3 md:gap-4">
            <div className="col-span-12 lg:col-span-8 tile-ink corner-mark overflow-hidden">
              <div className="grid grid-cols-12 px-6 py-3 border-b border-[var(--rule)] stencil text-[9px] text-zinc-500">
                <div className="col-span-1">No.</div>
                <div className="col-span-5">Category</div>
                <div className="col-span-3 text-right">kg CO₂e</div>
                <div className="col-span-3 text-right">Share</div>
              </div>
              <div className="divide-y divide-[var(--rule)]">
                {top5Categories.map((cat, i) => {
                  const isHovered = hoveredCat === cat.category;
                  const pct = (cat.kg / maxCatKg) * 100;
                  const totalShare =
                    (cat.kg / Math.max(totalKg + viewedKg, 1)) * 100;
                  return (
                    <div
                      key={cat.category}
                      className="relative grid grid-cols-12 items-center px-6 py-5 cursor-default"
                      onMouseEnter={() => setHoveredCat(cat.category)}
                      onMouseLeave={() => setHoveredCat(null)}
                    >
                      <div
                        className="absolute inset-y-0 left-0 transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: cat.uncertain
                            ? 'rgba(120, 113, 108, 0.12)'
                            : isHovered
                            ? 'rgba(182, 255, 60, 0.14)'
                            : 'rgba(31, 107, 63, 0.18)'
                        }}
                      />
                      <div className="relative col-span-1 display-mono text-zinc-700 text-[18px]">
                        {String(i + 1).padStart(2, '0')}
                      </div>
                      <div className="relative col-span-5 flex items-center gap-2">
                        <span
                          className={`display text-[20px] md:text-[26px] tracking-tight transition-colors ${
                            isHovered ? 'text-[#d8ffb0]' : 'text-zinc-100'
                          }`}
                        >
                          {getCategoryLabel(cat.category)}
                        </span>
                        {cat.uncertain && (
                          <span className="chip chip-warn">
                            <AlertTriangle size={9} />
                            uncertain
                          </span>
                        )}
                      </div>
                      <div
                        className={`relative col-span-3 text-right display-mono text-[20px] ${
                          isHovered ? 'text-[#b6ff3c]' : 'text-zinc-100'
                        }`}
                      >
                        {cat.kg.toFixed(1)}
                      </div>
                      <div className="relative col-span-3 text-right font-mono text-[11px] text-zinc-500 uppercase tracking-widest">
                        {totalShare.toFixed(0)}%
                      </div>
                    </div>
                  );
                })}
                {top5Categories.length === 0 && (
                  <div className="px-6 py-12 text-center text-zinc-600 font-mono text-sm">
                    No categories yet.
                  </div>
                )}
              </div>
            </div>

            {/* Data source distribution */}
            <div className="col-span-12 lg:col-span-4 tile p-6 corner-mark">
              <div className="flex items-center justify-between mb-4">
                <div className="eyebrow">Data source</div>
                <div className="chip">{rows.length} req</div>
              </div>
              <div className="flex items-center justify-center my-2">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={sourceTotals}
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={68}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="#04080a"
                      strokeWidth={2}
                    >
                      {sourceTotals.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 mt-2">
                {sourceTotals.map((s) => (
                  <div
                    key={s.key}
                    className="flex items-center justify-between text-[11px] font-mono"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2"
                        style={{ backgroundColor: s.fill }}
                      />
                      <span className="text-zinc-300">{s.name}</span>
                    </div>
                    <span className="text-zinc-500">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 05 — RECENT VIEWS
              Includes the carboknot-only Confirmed / Browsing / All
              filter alongside the merchant filters.
           ============================================================ */}
        <section id="recent" className="fade-in-up fade-in-up-delay-4 scroll-mt-8">
          <PosterHeader
            index="05"
            kicker="Activity log"
            title="Recent Views"
            hint={`${rows.length} records on file`}
          />

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex">
              {(['all', 'confirmed', 'browsing'] as const).map((t, idx) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`btn-block btn-block-sm capitalize ${idx > 0 ? '-ml-px' : ''} ${
                    filterType === t ? 'btn-block-active' : ''
                  }`}
                >
                  {t === 'confirmed' ? '✓ confirmed' : t === 'browsing' ? '○ browsing' : 'all'}
                </button>
              ))}
            </div>
            <span className="hidden md:inline-block w-px h-5 bg-[var(--rule)] mx-1" />
            {merchants.map((m) => (
              <button
                key={m}
                onClick={() => setFilterMerchant(m)}
                className={`btn-block btn-block-sm capitalize ${
                  filterMerchant === m ? 'btn-block-active' : ''
                }`}
              >
                {m}
              </button>
            ))}
            <div className="flex-1" />
            <div className="chip">
              <Eye size={10} />
              {sortedRows.length} of {rows.length}
            </div>
          </div>

          <div className="tile-ink corner-mark overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-[var(--rule)] hover:bg-transparent">
                  <TableHead
                    className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-mono w-24 cursor-pointer hover:text-[#b6ff3c] transition-colors select-none px-5 py-3"
                    onClick={() => handleSort('ts')}
                  >
                    <span className="flex items-center gap-1">
                      Time <SortIcon k="ts" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-mono w-28 cursor-pointer hover:text-[#b6ff3c] transition-colors select-none"
                    onClick={() => handleSort('merchant')}
                  >
                    <span className="flex items-center gap-1">
                      Merchant <SortIcon k="merchant" />
                    </span>
                  </TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-mono">
                    Title
                  </TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-mono w-32">
                    Category
                  </TableHead>
                  <TableHead
                    className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-mono w-36 text-right cursor-pointer hover:text-[#b6ff3c] transition-colors select-none"
                    onClick={() => handleSort('kg_total')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      kg ± CI <SortIcon k="kg_total" />
                    </span>
                  </TableHead>
                  <TableHead className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-mono w-32">
                    Source
                  </TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-[var(--rule)] cursor-pointer hover:bg-[rgba(182,255,60,0.04)] transition-colors group"
                    onClick={() => setSelectedRow(row)}
                  >
                    <TableCell className="text-zinc-500 text-[11px] font-mono whitespace-nowrap pl-5">
                      {formatRelativeTime(row.ts)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`capitalize text-[10px] uppercase tracking-widest font-mono border px-2 py-0.5 ${
                          MERCHANT_COLORS[row.merchant] ??
                          'border-zinc-700 text-zinc-400 bg-zinc-800/40'
                        }`}
                      >
                        {row.merchant}
                      </span>
                    </TableCell>
                    <TableCell className="text-[12px] text-zinc-200 max-w-[280px] group-hover:text-zinc-50 transition-colors">
                      <span className="block truncate font-medium">{row.title}</span>
                      {row.purchased && (
                        <span className="text-[9px] font-mono uppercase tracking-widest border border-[rgba(182,255,60,0.45)] text-[#d8ffb0] bg-[rgba(182,255,60,0.06)] px-1.5 py-0.5 mt-0.5 inline-block whitespace-nowrap">
                          confirmed
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-[10px] uppercase tracking-widest border px-2 py-0.5 font-mono ${
                          row.category_uncertain
                            ? 'border-amber-700/40 text-amber-300 bg-amber-950/30'
                            : 'border-[var(--rule)] text-zinc-400 bg-[#0a110d]'
                        }`}
                      >
                        {getCategoryLabel(row.category)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-[13px] font-mono whitespace-nowrap">
                      <span className="text-zinc-50 font-bold group-hover:text-[#b6ff3c] transition-colors">
                        {row.kg_total.toFixed(1)}
                      </span>
                      <span className="text-zinc-600 ml-1">
                        ± {(row.kg_ci_high - row.kg_total).toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-[10px] uppercase tracking-widest border px-2 py-0.5 font-mono ${
                          SOURCE_BADGE_CLASS[row.data_source] ?? ''
                        }`}
                      >
                        {sourceBadgeLabel(row.data_source)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ChevronRight
                        size={13}
                        className="text-zinc-700 group-hover:text-[#b6ff3c] group-hover:translate-x-0.5 transition-all"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {sortedRows.length === 0 && (
              <div className="py-16 text-center text-zinc-600 text-sm font-mono">
                <Eye size={20} className="mx-auto mb-2 text-zinc-700" />
                No records for selected filter.
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-mono uppercase tracking-widest">
              <Eye size={11} />
              Click row to inspect trace
            </div>
            <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-mono uppercase tracking-widest">
              <Zap size={11} className="text-[#b6ff3c]/70" />
              Every kg has a citation
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 06 — PRIVACY RECEIPT
           ============================================================ */}
        <section id="privacy" className="fade-in-up scroll-mt-8">
          <PosterHeader
            index="06"
            kicker="Audit printout"
            title="Privacy Receipt"
            hint="data-sharing posture · this session"
          />

          <div className="grid grid-cols-12 gap-3 md:gap-4">
            <div className="col-span-12 lg:col-span-8 tile-acid p-7 md:p-9 corner-mark relative overflow-hidden">
              <div className="absolute inset-0 scanline opacity-25 pointer-events-none" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-1.5 border border-[rgba(182,255,60,0.45)] bg-[rgba(182,255,60,0.06)]">
                    <ShieldCheck size={14} className="text-[#b6ff3c]" />
                  </div>
                  <span className="stencil text-[11px] text-[#d8ffb0]">
                    VERIFIED · LOCAL‑FIRST
                  </span>
                  <div className="flex-1 ring-divider" />
                  <span className="chip chip-acid">
                    <Radio size={10} />
                    SESSION
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                  {[
                    {
                      label: 'Cache Hits',
                      value: cacheStats.hit_count_session,
                      sub: 'stayed local · 0 requests',
                      icon: <HardDrive size={13} />
                    },
                    {
                      label: 'API Calls',
                      value: cacheStats.miss_count_session,
                      sub: 'ISIC4 + price only',
                      icon: <Cloud size={13} />
                    },
                    {
                      label: 'Cache Size',
                      value: cacheStats.total_entries,
                      sub: 'products on disk',
                      icon: <Database size={13} />
                    }
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="border border-[var(--rule)] bg-[#04080a]/60 px-4 py-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="stencil text-[10px] text-zinc-500">
                          {stat.label}
                        </div>
                        <div className="text-[#b6ff3c]">{stat.icon}</div>
                      </div>
                      <div className="display-mono text-[#d8ffb0] text-[36px] acid-glow">
                        {stat.value}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-1 font-mono">
                        {stat.sub}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-[rgba(182,255,60,0.22)] pt-4">
                  <p className="text-[12px] text-zinc-300 leading-relaxed font-mono">
                    Every new product/price combination triggers{' '}
                    <span className="text-zinc-50 font-bold">one</span> outbound
                    call to our Render proxy, which forwards{' '}
                    <span className="text-[#b6ff3c] font-bold">only</span> the
                    ISIC4 classification code and the price to Climatiq.{' '}
                    <span className="text-zinc-50">
                      No titles, no URLs, no identity, no browsing history.
                    </span>{' '}
                    Cached results are reused forever.
                  </p>
                </div>
              </div>
            </div>

            {/* Side: receipt printout */}
            <div className="col-span-12 lg:col-span-4 tile-ink corner-mark p-6 font-mono">
              <div className="border-b border-dashed border-[var(--rule)] pb-3 mb-3">
                <div className="stencil text-[10px] text-zinc-500">
                  RECEIPT // {methodologyVersion}
                </div>
                <div className="text-[10px] text-zinc-600 mt-1">
                  {new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC
                </div>
              </div>
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Local ratio</span>
                  <span className="text-[#b6ff3c]">{localPct}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Telemetry</span>
                  <span className="text-zinc-200">DISABLED</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Identity</span>
                  <span className="text-zinc-200">NONE</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">URLs sent</span>
                  <span className="text-zinc-200">0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Titles sent</span>
                  <span className="text-zinc-200">0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Storage</span>
                  <span className="text-zinc-200">DEVICE‑LOCAL</span>
                </div>
              </div>
              <div className="mt-4 border-t border-dashed border-[var(--rule)] pt-3">
                <div className="text-[10px] text-zinc-500 leading-relaxed">
                  ▌ Signed by Carboknot client · Open source · Reproducible build
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 07 — ACTIVITY LEDGER (carboknot-specific)
              Append-only on-device audit log of badge clicks, proxy
              round-trips, K2 narration views, etc. Polled every 5s by
              useAuditLog from IndexedDB.
           ============================================================ */}
        <section id="activity" className="fade-in-up scroll-mt-8">
          <PosterHeader
            index="07"
            kicker="On-device audit log"
            title="Activity Ledger"
            hint={`${auditRows.length} events · never transmitted`}
          />

          <div className="tile-ink corner-mark p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1.5 border border-[var(--rule)] bg-[#0a110d] text-zinc-300">
                <ScrollText size={13} />
              </div>
              <span className="text-[11px] text-zinc-400 font-mono uppercase tracking-widest">
                Append-only · on-device · zero outbound
              </span>
              <div className="flex-1" />
              <span className="chip">
                <Radio size={10} className="text-[#b6ff3c]" />
                LIVE · 5s POLL
              </span>
            </div>
            {auditRows.length === 0 ? (
              <div className="text-[11px] font-mono text-zinc-600 py-10 text-center uppercase tracking-widest">
                No events yet. Badge clicks and proxy round-trips will land here.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--rule)]">
                {auditRows.map((row) => (
                  <li
                    key={row.id ?? `${row.timestamp}-${row.event_type}`}
                    className="flex items-center gap-3 py-2.5 text-[11px]"
                  >
                    <span
                      className={`shrink-0 px-2 py-0.5 border font-mono uppercase tracking-widest text-[10px] whitespace-nowrap ${
                        AUDIT_EVENT_COLOR[row.event_type] ??
                        'border-zinc-700/50 text-zinc-400 bg-zinc-800/40'
                      }`}
                    >
                      {AUDIT_EVENT_LABEL[row.event_type] ?? row.event_type}
                    </span>
                    <span className="text-zinc-500 font-mono truncate flex-1">
                      {describeAuditDetails(row.event_type, row.details)}
                    </span>
                    <span className="shrink-0 text-zinc-600 font-mono">
                      {formatRelativeTime(new Date(row.timestamp).getTime())}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ============================================================
            SECTION 08 — METHODOLOGY
           ============================================================ */}
        <section id="methodology" className="fade-in-up scroll-mt-8">
          <PosterHeader
            index="08"
            kicker="Source note"
            title="Methodology"
            hint="EXIOBASE spend-based LCA"
          />

          <div className="grid grid-cols-12 gap-3 md:gap-4">
            <div className="col-span-12 md:col-span-5 tile p-6 corner-mark">
              <div className="eyebrow mb-3">Active version</div>
              <div className="display text-[#b6ff3c] acid-glow text-[56px] md:text-[72px] leading-none">
                {methodologyVersion}
              </div>
              <div className="mt-4 font-mono text-[11px] text-zinc-500 uppercase tracking-widest">
                Climatiq · EXIOBASE · spend-based LCA
              </div>
            </div>

            <div className="col-span-12 md:col-span-7 grid grid-cols-2 gap-3 md:gap-4">
              <div className="tile px-5 py-5 corner-mark">
                <div className="eyebrow mb-2">Region scope</div>
                <div className="display-mono text-zinc-50 text-[24px]">Global</div>
                <div className="text-[10px] text-zinc-500 mt-2 font-mono uppercase tracking-widest">
                  with US fallback factors
                </div>
              </div>
              <div className="tile px-5 py-5 corner-mark">
                <div className="eyebrow mb-2">Confidence model</div>
                <div className="display-mono text-zinc-50 text-[24px]">CI 95%</div>
                <div className="text-[10px] text-zinc-500 mt-2 font-mono uppercase tracking-widest">
                  derived from EF spread
                </div>
              </div>
              <div className="tile px-5 py-5 corner-mark">
                <div className="eyebrow mb-2">Categorization</div>
                <div className="display-mono text-zinc-50 text-[24px]">ISIC4</div>
                <div className="text-[10px] text-zinc-500 mt-2 font-mono uppercase tracking-widest">
                  rev. 4 industry codes
                </div>
              </div>
              <div className="tile px-5 py-5 corner-mark">
                <div className="eyebrow mb-2">Update cadence</div>
                <div className="display-mono text-zinc-50 text-[24px]">Quarterly</div>
                <div className="text-[10px] text-zinc-500 mt-2 font-mono uppercase tracking-widest">
                  factor refresh window
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--rule)] pt-5 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
            <span>
              Carboknot · {methodologyVersion} · Climatiq EXIOBASE spend-based LCA
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-[#b6ff3c] pulse-acid" />
              local-first · no telemetry · open source
            </span>
          </div>
        </section>
      </main>

      {/* ============================================================
          BOTTOM DOCK NAV — appears after scroll
         ============================================================ */}
      <nav
        className={`dock ${dockVisible ? 'dock-visible' : ''}`}
        aria-label="Section navigation"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => jumpTo(s.id)}
            className={`dock-seg ${activeSection === s.id ? 'dock-seg-active' : ''}`}
            aria-current={activeSection === s.id ? 'true' : undefined}
          >
            <span className="code">{s.code}</span>
            <span className="label">{s.label}</span>
          </button>
        ))}
      </nav>

      <TraceDrawer
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
        onOffset={handleOffsetProduct}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        methodologyVersion={methodologyVersion}
      />
    </div>
  );
}
