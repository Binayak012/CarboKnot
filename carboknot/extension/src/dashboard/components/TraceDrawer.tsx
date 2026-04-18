import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/dashboard/components/ui/sheet';
import type { ViewRow, Trace } from '@/dashboard/lib/types';
import { formatRelativeTime, sourceBadgeLabel } from '@/dashboard/lib/utils-dashboard';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  FileText,
  Hash,
  ChevronRight
} from 'lucide-react';

interface TraceDrawerProps {
  row: ViewRow | null;
  onClose: () => void;
}

const SOURCE_COLORS: Record<string, string> = {
  climatiq_fresh: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50',
  climatiq_cached: 'bg-sky-950/50 text-sky-300 border-sky-700/40',
  local_fallback: 'bg-zinc-800/60 text-zinc-400 border-zinc-600/40'
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'text-emerald-300',
  medium: 'text-amber-300',
  low: 'text-orange-300'
};

const CONFIDENCE_BAR: Record<string, string> = {
  high: 'from-emerald-500/30 to-emerald-400',
  medium: 'from-amber-500/30 to-amber-400',
  low: 'from-orange-500/30 to-orange-400'
};

export function TraceDrawer({ row, onClose }: TraceDrawerProps) {
  const open = row !== null;

  let trace: Trace | null = null;
  if (row) {
    try {
      trace = JSON.parse(row.trace) as Trace;
    } catch {
      trace = null;
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl bg-[#04080a] text-zinc-100 overflow-y-auto p-0"
      >
        {row && trace && (
          <>
            <div className="sticky top-0 z-10 bg-[#04080a]/95 backdrop-blur-xl border-b border-emerald-900/30 px-6 py-5">
              <SheetHeader>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-400">
                    Carbon Trace
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-emerald-900/40 to-transparent" />
                </div>
                <SheetTitle className="text-zinc-50 text-base font-semibold leading-snug pr-6">
                  {row.title}
                </SheetTitle>
                <div className="flex flex-wrap gap-2 mt-2 items-center">
                  <span className="text-[11px] text-zinc-500 font-mono">{formatRelativeTime(row.ts)}</span>
                  <span className="text-zinc-700">·</span>
                  <span className="text-[11px] capitalize text-zinc-400">{row.merchant}</span>
                  <span className="text-zinc-700">·</span>
                  <span
                    className={`text-[11px] border rounded-full px-2 py-0.5 font-mono ${
                      SOURCE_COLORS[row.data_source] ?? ''
                    }`}
                  >
                    {sourceBadgeLabel(row.data_source)}
                  </span>
                </div>
              </SheetHeader>
            </div>

            <div className="px-6 pb-8 space-y-6 pt-6">

              <div className="surface-accent rounded-2xl p-5 relative overflow-hidden">
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
                <div className="relative">
                  <div className="flex items-baseline gap-3 mb-1">
                    <span className="text-5xl font-bold text-emerald-300 number-glow tabular-nums tracking-tight">
                      {row.kg_total.toFixed(1)}
                    </span>
                    <span className="text-lg text-emerald-400/70">kg CO₂e</span>
                    <div className="flex-1" />
                    <span className="text-xs font-mono text-zinc-400">
                      ± {(row.kg_ci_high - row.kg_total).toFixed(1)} kg
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
                    <span>CI range:</span>
                    <span className="text-zinc-300">{row.kg_ci_low.toFixed(1)}</span>
                    <span>–</span>
                    <span className="text-zinc-300">{row.kg_ci_high.toFixed(1)} kg</span>
                    {row.kg_total > 0 && (
                      <span className="ml-2 chip">
                        {Math.round(((row.kg_ci_high - row.kg_total) / row.kg_total) * 100)}% width
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <section>
                <SectionHeader icon={<CheckCircle2 size={11} />}>Confidence</SectionHeader>
                <div className="surface rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-base font-semibold capitalize ${
                          CONFIDENCE_COLOR[trace.confidence.level] ?? 'text-zinc-300'
                        }`}
                      >
                        {trace.confidence.level}
                      </span>
                      {trace.confidence.level === 'low' && (
                        <AlertTriangle size={13} className="text-orange-400" />
                      )}
                    </div>
                    <span className="text-zinc-400 text-xs font-mono tabular-nums">
                      {(trace.confidence.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-900 overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${
                        CONFIDENCE_BAR[trace.confidence.level] ?? 'from-zinc-700 to-zinc-500'
                      } transition-all duration-700`}
                      style={{ width: `${trace.confidence.score * 100}%` }}
                    />
                  </div>
                </div>
              </section>

              <section>
                <SectionHeader icon={<Hash size={11} />}>Inputs</SectionHeader>
                <div className="surface rounded-xl p-4 font-mono text-xs space-y-1.5">
                  <KvRow k="category" v={trace.inputs.category} />
                  <KvRow k="price" v={`$${trace.inputs.price_usd.toFixed(2)} ${trace.inputs.currency}`} />
                  {trace.inputs.region && <KvRow k="region" v={trace.inputs.region} />}
                  {trace.isic4_code && <KvRow k="isic4_code" v={trace.isic4_code} accent />}
                  {trace.climatiq_activity_id && (
                    <KvRow k="activity_id" v={trace.climatiq_activity_id} />
                  )}
                </div>
              </section>

              {trace.computation_steps.length > 0 && (
                <section>
                  <SectionHeader icon={<Activity size={11} />}>Computation Steps</SectionHeader>
                  <div className="surface rounded-xl p-4 space-y-2.5">
                    {trace.computation_steps.map((step, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 text-[12px] font-mono text-zinc-300 leading-relaxed"
                      >
                        <span className="text-emerald-500/60 mt-0.5">
                          <ChevronRight size={11} />
                        </span>
                        <span className="flex-1">{step}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {trace.assumptions.length > 0 && (
                <section>
                  <SectionHeader icon={<FileText size={11} />}>Assumptions</SectionHeader>
                  <div className="surface rounded-xl p-4">
                    <ul className="space-y-2">
                      {trace.assumptions.map((a, i) => (
                        <li key={i} className="flex items-start gap-3 text-xs text-zinc-400">
                          <span className="text-zinc-600 font-mono mt-0.5 text-[10px]">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              <section>
                <SectionHeader icon={<Cpu size={11} />}>Methodology</SectionHeader>
                <div className="surface rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 text-xs">version</span>
                    <span className="font-mono text-xs text-zinc-200 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5">
                      {trace.methodology_version}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 text-xs">data source</span>
                    <span
                      className={`font-mono border rounded-full px-2 py-0.5 text-[11px] ${
                        SOURCE_COLORS[trace.data_source] ?? ''
                      }`}
                    >
                      {sourceBadgeLabel(trace.data_source)}
                    </span>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SectionHeader({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-zinc-600">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
        {children}
      </span>
      <div className="flex-1 h-px bg-zinc-800/60" />
    </div>
  );
}

function KvRow({ k, v, accent = false }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{k}</span>
      <span className={accent ? 'text-emerald-300' : 'text-zinc-200'}>{v}</span>
    </div>
  );
}
