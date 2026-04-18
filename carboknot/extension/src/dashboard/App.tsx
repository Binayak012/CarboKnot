import { useState, useMemo, useEffect, useRef } from 'react';
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
  Leaf,
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
  Sparkles,
  Database,
  Radio
} from 'lucide-react';

import { Separator } from '@/dashboard/components/ui/separator';
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

const ACCENT = '#1A6B4A';
const ACCENT_BRIGHT = '#4ade80';
const MONTHLY_BUDGET = 200;

const SOURCE_BADGE_CLASS: Record<string, string> = {
  climatiq_fresh: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50',
  climatiq_cached: 'bg-sky-950/50 text-sky-300 border-sky-700/40',
  local_fallback: 'bg-zinc-800/60 text-zinc-400 border-zinc-600/40'
};

const MERCHANT_COLORS: Record<string, string> = {
  amazon: 'bg-amber-950/40 text-amber-300 border-amber-700/30',
  ebay: 'bg-blue-950/40 text-blue-300 border-blue-700/30',
  walmart: 'bg-sky-950/40 text-sky-300 border-sky-700/30',
  target: 'bg-red-950/40 text-red-300 border-red-700/30',
  bestbuy: 'bg-yellow-950/40 text-yellow-300 border-yellow-700/30'
};

const SOURCE_COLOR: Record<string, string> = {
  climatiq_fresh: '#4ade80',
  climatiq_cached: '#38bdf8',
  local_fallback: '#a3a3a3'
};

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

function Sparkline({
  data,
  color = ACCENT_BRIGHT,
  height = 36
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

function KpiCard({
  label,
  sub,
  icon,
  accent = false,
  animatedValue,
  unit = '',
  decimals = 0,
  sparkData,
  trend
}: {
  label: string;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  accent?: boolean;
  animatedValue: number;
  unit?: string;
  decimals?: number;
  sparkData?: number[];
  trend?: { value: number; label: string };
}) {
  const animated = useCountUp(animatedValue, 1400);
  const display = `${animated.toFixed(decimals)}${unit}`;

  return (
    <div
      className={`relative rounded-2xl px-6 py-6 card-hover overflow-hidden group ${
        accent ? 'surface-accent' : 'surface'
      }`}
    >
      <div className="absolute inset-0 shimmer opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

      <div className="relative">
        <div className="flex items-start justify-between mb-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            {label}
          </div>
          <div
            className={`p-2 rounded-lg ${
              accent
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-800'
            }`}
          >
            {icon}
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div
            className={`text-[40px] leading-none font-bold tabular-nums tracking-tight ${
              accent ? 'text-emerald-300 number-glow' : 'text-zinc-50'
            }`}
          >
            {display}
          </div>
          {trend && (
            <div
              className={`flex items-center gap-1 text-xs font-semibold mb-1 ${
                trend.value > 0
                  ? 'text-rose-400'
                  : trend.value < 0
                  ? 'text-emerald-400'
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

        {sub && <div className="text-[11px] text-zinc-500 mt-2">{sub}</div>}

        {sparkData && sparkData.length > 1 && (
          <div className="mt-3 -mx-1 opacity-90">
            <Sparkline
              data={sparkData}
              color={accent ? ACCENT_BRIGHT : '#52525b'}
              height={32}
            />
          </div>
        )}
      </div>
    </div>
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
    <div className="rounded-lg border border-emerald-500/40 bg-[#070d0a]/95 backdrop-blur px-3 py-2 text-xs shadow-2xl">
      <div className="text-zinc-500 mb-1 font-mono">{label}</div>
      <div className="font-bold text-emerald-300">
        {payload[0].value.toFixed(1)} kg CO₂e
      </div>
    </div>
  );
};

function SectionLabel({
  children,
  hint
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
          {children}
        </span>
        <div className="h-px bg-gradient-to-r from-zinc-700/60 to-transparent w-12" />
      </div>
      {hint && <span className="text-[10px] text-zinc-600 font-mono">{hint}</span>}
    </div>
  );
}

type SortKey = 'ts' | 'kg_total' | 'merchant';
type SortDir = 'asc' | 'desc';

export default function App() {
  const rows = useHistory();
  const cacheStats = useCacheStats();

  const [selectedRow, setSelectedRow] = useState<ViewRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('ts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterMerchant, setFilterMerchant] = useState<string>('all');
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'area' | 'bar'>('area');
  const [filterType, setFilterType] = useState<'all' | 'confirmed' | 'browsing'>('all');

  const methodologyVersion = useMemo(() => getMethodologyVersion(rows), [rows]);

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
      purchasedRows.filter((r) => r.ts >= startOfMonth).reduce((s, r) => s + r.kg_total, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [purchasedRows]
  );
  const budgetPct = Math.min(100, (monthKg / MONTHLY_BUDGET) * 100);
  const budgetColor =
    budgetPct > 80 ? '#ef4444' : budgetPct > 60 ? '#f59e0b' : ACCENT_BRIGHT;
  const radialData = [{ name: 'used', value: budgetPct, fill: budgetColor }];

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
  }, [rows, sortKey, sortDir, filterMerchant]);

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
      <TrendingDown size={10} className="text-emerald-400" />
    ) : (
      <TrendingUp size={10} className="text-emerald-400" />
    );
  };

  // Empty state — no rows AND seed didn't load. Should be rare in demo, but safe fallback.
  if (rows.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500 font-mono text-sm">
        Loading local history…
      </div>
    );
  }

  return (
    <div className="min-h-screen text-zinc-100 grid-bg relative">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-emerald-500/[0.06] blur-[120px] rounded-full" />

      <header className="sticky top-0 z-40 border-b border-emerald-900/30 bg-[#04080a]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-700/10 ring-1 ring-emerald-500/30">
              <Leaf size={18} className="text-emerald-300" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 pulse-green" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-zinc-50 tracking-tight text-base leading-none">
                Carboknot
              </span>
              <span className="text-[10px] text-zinc-500 mt-0.5 tracking-wide">
                data-first carbon receipt
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-lg p-2.5 text-zinc-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-all duration-200 group ring-1 ring-transparent hover:ring-emerald-500/20"
              aria-label="Settings"
            >
              <Settings
                size={16}
                className="group-hover:rotate-45 transition-transform duration-300"
              />
            </button>
          </div>
        </div>
        <div className="ring-divider" />
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10 relative z-10">

        <section className="fade-in-up">
          <SectionLabel hint="last 30 days">Carbon Footprint Overview</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Confirmed CO₂e"
              animatedValue={totalKg}
              decimals={1}
              unit=" kg"
              sub={<span className="font-mono">{viewedKg.toFixed(1)} kg browsed, not counted</span>}
              icon={<Activity size={14} />}
              accent
              sparkData={last7TrendValues}
              trend={{ value: weekDelta, label: 'vs last week' }}
            />
            <KpiCard
              label="Equivalent miles driven"
              animatedValue={milesDriven}
              decimals={0}
              sub={<span>@ 0.4 kg CO₂e per mile (avg US car)</span>}
              icon={<MapPin size={14} />}
            />
            <KpiCard
              label="Confirmed buys"
              animatedValue={purchasedRows.length}
              decimals={0}
              sub={<span>{viewedRows.length} browsed, awaiting confirmation</span>}
              icon={<Package size={14} />}
            />
            <KpiCard
              label="Local-first ratio"
              animatedValue={localPct}
              decimals={0}
              unit="%"
              sub={<span>{cacheStats.hit_count_session} cache hits this session</span>}
              icon={<HardDrive size={14} />}
            />
          </div>
        </section>

        <section className="fade-in-up fade-in-up-delay-1">
          <div className="surface rounded-2xl px-6 py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
              <Sparkles size={13} />
              Insights
            </div>
            {topCat && (
              <div className="text-xs text-zinc-400">
                Top emitter:{' '}
                <span className="text-zinc-100 font-medium">
                  {getCategoryLabel(topCat.category)}
                </span>
                <span className="text-zinc-600 ml-1.5">
                  ({topCat.kg.toFixed(0)} kg ·{' '}
                  {totalKg > 0 ? Math.round((topCat.kg / totalKg) * 100) : 0}% of total)
                </span>
              </div>
            )}
            {heaviestRow && (
              <div className="text-xs text-zinc-400">
                Heaviest item:{' '}
                <span className="text-zinc-100 font-medium truncate max-w-[180px] inline-block align-bottom">
                  {heaviestRow.title}
                </span>
                <span className="text-zinc-600 ml-1.5">
                  {heaviestRow.kg_total.toFixed(0)} kg
                </span>
              </div>
            )}
            {lightestRow && (
              <div className="text-xs text-zinc-400">
                Lightest:{' '}
                <span className="text-zinc-100 font-medium">
                  {lightestRow.kg_total.toFixed(1)} kg
                </span>
                <span className="text-zinc-600 ml-1.5">
                  ({getCategoryLabel(lightestRow.category)})
                </span>
              </div>
            )}
            <div className="flex-1" />
            <div className="text-[11px] font-mono text-zinc-600">
              monthly pace · {monthKg.toFixed(0)} / {MONTHLY_BUDGET} kg
            </div>
          </div>
        </section>

        <section className="fade-in-up fade-in-up-delay-2">
          <div className="flex items-end justify-between">
            <SectionLabel hint={`${trendData.length} days`}>Daily CO₂e Trend</SectionLabel>
            <div className="flex items-center gap-1 mb-4">
              <button
                onClick={() => setChartMode('area')}
                className={`text-[10px] font-semibold px-3 py-1 rounded-md border transition-all duration-150 ${
                  chartMode === 'area'
                    ? 'tab-active'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                }`}
              >
                Area
              </button>
              <button
                onClick={() => setChartMode('bar')}
                className={`text-[10px] font-semibold px-3 py-1 rounded-md border transition-all duration-150 ${
                  chartMode === 'bar'
                    ? 'tab-active'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                }`}
              >
                Bar
              </button>
            </div>
          </div>
          <div className="surface rounded-2xl p-6">
            <ResponsiveContainer width="100%" height={260}>
              {chartMode === 'area' ? (
                <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="kgGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT_BRIGHT} stopOpacity={0.45} />
                      <stop offset="60%" stopColor={ACCENT_BRIGHT} stopOpacity={0.08} />
                      <stop offset="100%" stopColor={ACCENT_BRIGHT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0f1a14" vertical={false} />
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
                    stroke={ACCENT_BRIGHT}
                    strokeWidth={2.2}
                    fill="url(#kgGrad)"
                    dot={false}
                    activeDot={{
                      r: 5,
                      fill: ACCENT_BRIGHT,
                      stroke: '#04080a',
                      strokeWidth: 3
                    }}
                  />
                </AreaChart>
              ) : (
                <BarChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0f1a14" vertical={false} />
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
                  <Bar dataKey="kg" radius={[4, 4, 0, 0]}>
                    {trendData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.kg > 0 ? ACCENT_BRIGHT : '#0f1a14'}
                        opacity={entry.kg > 0 ? 0.85 : 0.3}
                      />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </section>

        <section className="fade-in-up fade-in-up-delay-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <div className="md:col-span-3">
              <SectionLabel>Monthly Budget</SectionLabel>
              <div className="surface rounded-2xl p-6 flex flex-col items-center justify-center min-h-[280px] relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/[0.06] to-transparent pointer-events-none" />
                <div className="relative glow-ring">
                  <RadialBarChart
                    width={180}
                    height={180}
                    cx={90}
                    cy={90}
                    innerRadius={62}
                    outerRadius={82}
                    data={radialData}
                    startAngle={90}
                    endAngle={-270}
                    barSize={16}
                  >
                    <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                    <RadialBar
                      background={{ fill: '#0d1612' }}
                      dataKey="value"
                      cornerRadius={8}
                      fill={budgetColor}
                      angleAxisId={0}
                    />
                  </RadialBarChart>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-3xl font-bold text-zinc-50 tabular-nums">
                      {monthKg.toFixed(0)}
                    </span>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">
                      kg
                    </span>
                  </div>
                </div>
                <div className="mt-4 text-center space-y-1">
                  <div
                    className="text-base font-bold tabular-nums"
                    style={{ color: budgetColor }}
                  >
                    {budgetPct.toFixed(0)}%
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    of {MONTHLY_BUDGET} kg monthly cap
                  </div>
                  <div className="text-[10px] text-zinc-600 font-mono">
                    {(MONTHLY_BUDGET - monthKg).toFixed(0)} kg remaining
                  </div>
                </div>
              </div>
            </div>

            <div className="md:col-span-6">
              <SectionLabel hint={`${categoryTotals.length} categories`}>Top Categories</SectionLabel>
              <div className="surface rounded-2xl p-6 h-full min-h-[280px]">
                <div className="space-y-5">
                  {top5Categories.map((cat, i) => {
                    const isHovered = hoveredCat === cat.category;
                    const pct = (cat.kg / maxCatKg) * 100;
                    return (
                      <div
                        key={cat.category}
                        className="space-y-1.5 cursor-default group"
                        onMouseEnter={() => setHoveredCat(cat.category)}
                        onMouseLeave={() => setHoveredCat(null)}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2.5">
                            <span className="text-[10px] font-mono text-zinc-600 w-4">
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <span
                              className={`transition-colors duration-150 ${
                                isHovered ? 'text-emerald-300' : 'text-zinc-200'
                              }`}
                            >
                              {getCategoryLabel(cat.category)}
                            </span>
                            {cat.uncertain && (
                              <span className="flex items-center gap-1 font-mono text-[10px] border border-amber-700/40 text-amber-300 rounded-full px-1.5 py-0.5 bg-amber-950/30">
                                <AlertTriangle size={8} />
                                uncertain
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`font-mono tabular-nums text-xs ${
                                isHovered ? 'text-emerald-300' : 'text-zinc-300'
                              }`}
                            >
                              {cat.kg.toFixed(1)} kg
                            </span>
                            <span className="text-[10px] text-zinc-600 font-mono w-9 text-right">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-[#0d1612] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: cat.uncertain
                                ? '#78716c'
                                : isHovered
                                ? ACCENT_BRIGHT
                                : ACCENT,
                              boxShadow: isHovered
                                ? `0 0 10px ${cat.uncertain ? '#78716c' : ACCENT_BRIGHT}`
                                : 'none'
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="md:col-span-3">
              <SectionLabel>Data Source</SectionLabel>
              <div className="surface rounded-2xl p-6 h-full min-h-[280px] flex flex-col">
                <div className="flex-1 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie
                        data={sourceTotals}
                        cx="50%"
                        cy="50%"
                        innerRadius={36}
                        outerRadius={58}
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
                      className="flex items-center justify-between text-[11px]"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: s.fill }}
                        />
                        <span className="text-zinc-400">{s.name}</span>
                      </div>
                      <span className="text-zinc-500 font-mono">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="fade-in-up fade-in-up-delay-3">
          <SectionLabel hint="data-sharing posture">Privacy Receipt</SectionLabel>
          <div className="surface-accent rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

            <div className="relative">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-1.5 rounded-md bg-emerald-500/15 ring-1 ring-emerald-500/30">
                  <ShieldCheck size={14} className="text-emerald-300" />
                </div>
                <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">
                  Verified local-first
                </span>
                <div className="flex-1 ring-divider" />
                <span className="chip">
                  <Radio size={10} className="text-emerald-400" />
                  this session
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                {[
                  {
                    label: 'Cache Hits',
                    value: cacheStats.hit_count_session,
                    sub: 'stayed local — zero requests',
                    color: 'text-emerald-300',
                    fill: '#4ade80',
                    icon: <HardDrive size={13} />
                  },
                  {
                    label: 'API Calls',
                    value: cacheStats.miss_count_session,
                    sub: 'ISIC4 + price only',
                    color: 'text-sky-300',
                    fill: '#38bdf8',
                    icon: <Cloud size={13} />
                  },
                  {
                    label: 'Cache Size',
                    value: cacheStats.total_entries,
                    sub: 'products cached locally',
                    color: 'text-zinc-200',
                    fill: '#a3a3a3',
                    icon: <Database size={13} />
                  }
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border border-zinc-800/80 bg-[#070d0a]/60 px-4 py-3 backdrop-blur-sm"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                        {stat.label}
                      </div>
                      <div style={{ color: stat.fill }}>{stat.icon}</div>
                    </div>
                    <div
                      className={`text-3xl font-bold font-mono tabular-nums ${stat.color}`}
                    >
                      {stat.value}
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-1">{stat.sub}</div>
                  </div>
                ))}
              </div>

              <Separator className="bg-emerald-900/30 mb-4" />

              <p className="text-xs text-zinc-400 leading-relaxed">
                Every new product category/price combination triggers{' '}
                <span className="text-zinc-200">one</span> outbound call to our Render
                proxy, which forwards <span className="text-emerald-300">only</span> the
                ISIC4 classification code and the price to Climatiq.{' '}
                <span className="text-zinc-200">
                  No titles, no URLs, no identity, no browsing history.
                </span>{' '}
                Cached results are reused forever.
              </p>
            </div>
          </div>
        </section>

        <section className="fade-in-up fade-in-up-delay-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionLabel hint={`${sortedRows.length} shown`}>Purchase History</SectionLabel>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <div className="flex items-center gap-1 border border-zinc-800 rounded-lg p-0.5">
                {(['all', 'confirmed', 'browsing'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`text-[10px] font-semibold capitalize px-2.5 py-1 rounded-md transition-all duration-150 ${
                      filterType === t
                        ? 'tab-active'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {t === 'confirmed' ? '✓ confirmed' : t === 'browsing' ? '○ browsing' : 'all'}
                  </button>
                ))}
              </div>
              {merchants.map((m) => (
                <button
                  key={m}
                  onClick={() => setFilterMerchant(m)}
                  className={`text-[10px] font-semibold capitalize px-2.5 py-1 rounded-md border transition-all duration-150 ${
                    filterMerchant === m
                      ? 'tab-active'
                      : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="surface rounded-2xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800/60 hover:bg-transparent">
                  <TableHead
                    className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider w-24 cursor-pointer hover:text-emerald-400 transition-colors select-none px-5 py-3"
                    onClick={() => handleSort('ts')}
                  >
                    <span className="flex items-center gap-1">
                      Time <SortIcon k="ts" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider w-28 cursor-pointer hover:text-emerald-400 transition-colors select-none"
                    onClick={() => handleSort('merchant')}
                  >
                    <span className="flex items-center gap-1">
                      Merchant <SortIcon k="merchant" />
                    </span>
                  </TableHead>
                  <TableHead className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider">
                    Title
                  </TableHead>
                  <TableHead className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider w-32">
                    Category
                  </TableHead>
                  <TableHead
                    className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider w-36 text-right cursor-pointer hover:text-emerald-400 transition-colors select-none"
                    onClick={() => handleSort('kg_total')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      kg ± CI <SortIcon k="kg_total" />
                    </span>
                  </TableHead>
                  <TableHead className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider w-32">
                    Source
                  </TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-zinc-900/80 cursor-pointer hover:bg-emerald-500/[0.04] transition-colors group"
                    onClick={() => setSelectedRow(row)}
                  >
                    <TableCell className="text-zinc-500 text-[11px] font-mono whitespace-nowrap pl-5">
                      {formatRelativeTime(row.ts)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`capitalize text-[11px] border rounded-full px-2 py-0.5 ${
                          MERCHANT_COLORS[row.merchant] ??
                          'bg-zinc-800 text-zinc-400 border-zinc-700'
                        }`}
                      >
                        {row.merchant}
                      </span>
                    </TableCell>
                    <TableCell className="text-[12px] text-zinc-300 max-w-[260px] group-hover:text-zinc-100 transition-colors">
                      <span className="block truncate">{row.title}</span>
                      {row.purchased && (
                        <span className="text-[10px] font-mono bg-emerald-950/40 text-emerald-400 border border-emerald-700/40 rounded-full px-1.5 py-0.5 mt-0.5 inline-block whitespace-nowrap">
                          confirmed
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-[11px] rounded-full px-2 py-0.5 border font-mono ${
                          row.category_uncertain
                            ? 'bg-amber-950/30 text-amber-300 border-amber-700/40'
                            : 'bg-[#0d1612] text-zinc-400 border-zinc-800/80'
                        }`}
                      >
                        {getCategoryLabel(row.category)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-[12px] font-mono whitespace-nowrap">
                      <span className="text-zinc-100 font-semibold group-hover:text-emerald-300 transition-colors">
                        {row.kg_total.toFixed(1)}
                      </span>
                      <span className="text-zinc-600 ml-1">
                        ± {(row.kg_ci_high - row.kg_total).toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-[11px] border rounded-full px-2 py-0.5 font-mono ${
                          SOURCE_BADGE_CLASS[row.data_source] ?? ''
                        }`}
                      >
                        {sourceBadgeLabel(row.data_source)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ChevronRight
                        size={13}
                        className="text-zinc-700 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all"
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
            <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-mono">
              <Eye size={11} />
              {sortedRows.length} of {rows.length} records · click row to inspect trace
            </div>
            <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-mono">
              <Zap size={11} className="text-emerald-500/60" />
              every kg has a citation
            </div>
          </div>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-8 mt-6 border-t border-zinc-900/80">
        <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-zinc-600 font-mono">
          <span>Carboknot · {methodologyVersion} · Climatiq EXIOBASE spend-based LCA</span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-green" />
            local-first · no telemetry · open source
          </span>
        </div>
      </footer>

      <TraceDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        methodologyVersion={methodologyVersion}
      />
    </div>
  );
}
