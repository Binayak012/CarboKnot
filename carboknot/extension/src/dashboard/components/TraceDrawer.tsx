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
  ChevronRight,
  Leaf
} from 'lucide-react';

interface TraceDrawerProps {
  row: ViewRow | null;
  onClose: () => void;
  onOffset?: (row: ViewRow) => void;
}

const SOURCE_BADGE: Record<string, string> = {
  climatiq_fresh:
    'border-[rgba(182,255,60,0.45)] text-[#d8ffb0] bg-[rgba(182,255,60,0.06)]',
  climatiq_cached: 'border-sky-700/50 text-sky-300 bg-sky-950/40',
  local_fallback: 'border-zinc-600/40 text-zinc-400 bg-zinc-800/40'
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'text-[#d8ffb0]',
  medium: 'text-amber-300',
  low: 'text-orange-300'
};

const CONFIDENCE_FILL: Record<string, string> = {
  high: '#b6ff3c',
  medium: '#fbbf24',
  low: '#fb923c'
};

export function TraceDrawer({ row, onClose, onOffset }: TraceDrawerProps) {
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
        className="w-full sm:max-w-xl bg-[#04080a] text-zinc-100 overflow-y-auto p-0 border-l border-[rgba(182,255,60,0.32)]"
      >
        {row && trace && (
          <>
            {/* Header — stencil + ledger style */}
            <div className="sticky top-0 z-10 bg-[#04080a]/95 backdrop-blur-xl border-b border-[var(--rule)] px-6 py-5">
              <SheetHeader>
                <div className="flex items-center gap-2 mb-3">
                  <span className="stencil text-[10px] text-[#b6ff3c]">
                    CARBON TRACE
                  </span>
                  <div className="flex-1 ring-divider" />
                  <span
                    className={`text-[10px] uppercase tracking-widest border px-2 py-0.5 font-mono ${
                      SOURCE_BADGE[row.data_source] ?? ''
                    }`}
                  >
                    {sourceBadgeLabel(row.data_source)}
                  </span>
                </div>
                <SheetTitle className="display text-zinc-50 text-[22px] leading-tight pr-6">
                  {row.title}
                </SheetTitle>
                <div className="flex flex-wrap gap-2 mt-3 items-center text-[10px] uppercase tracking-widest font-mono text-zinc-500">
                  <span>{formatRelativeTime(row.ts)}</span>
                  <span className="text-zinc-700">/</span>
                  <span className="capitalize text-zinc-400">{row.merchant}</span>
                  {row.purchased && (
                    <>
                      <span className="text-zinc-700">/</span>
                      <span className="chip chip-acid">CONFIRMED</span>
                    </>
                  )}
                </div>
              </SheetHeader>
            </div>

            <div className="px-6 pb-10 space-y-6 pt-6">
              {/* KG hero */}
              <div className="tile-acid p-6 corner-mark relative overflow-hidden">
                <div className="absolute inset-0 hatch opacity-40 pointer-events-none" />
                <div className="relative">
                  <div className="eyebrow-acid mb-3">Total CO₂e</div>
                  <div className="flex items-end gap-3">
                    <div className="display text-[#d8ffb0] acid-glow text-[68px] leading-[0.8]">
                      {row.kg_total.toFixed(1)}
                    </div>
                    <div className="pb-2">
                      <div className="display-mono text-[#b6ff3c] text-[20px]">
                        kg
                      </div>
                      <div className="eyebrow mt-1">CO₂e</div>
                    </div>
                    <div className="flex-1" />
                    <div className="text-right pb-2">
                      <div className="stencil text-[9px] text-zinc-500">± CI</div>
                      <div className="display-mono text-zinc-200 text-[18px] mt-1">
                        {(row.kg_ci_high - row.kg_total).toFixed(1)} kg
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3 text-[11px] text-zinc-500 font-mono uppercase tracking-widest">
                    <span>CI range</span>
                    <span className="text-zinc-300">
                      {row.kg_ci_low.toFixed(1)}
                    </span>
                    <span className="text-zinc-600">–</span>
                    <span className="text-zinc-300">
                      {row.kg_ci_high.toFixed(1)} kg
                    </span>
                    {row.kg_total > 0 && (
                      <span className="ml-2 chip">
                        {Math.round(
                          ((row.kg_ci_high - row.kg_total) / row.kg_total) * 100
                        )}
                        % width
                      </span>
                    )}
                  </div>
                  {onOffset && row.kg_total > 0 && (
                    <div className="mt-5 pt-4 border-t border-[rgba(182,255,60,0.18)] flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                        Make it right
                      </div>
                      <button
                        type="button"
                        onClick={() => onOffset(row)}
                        className="btn-block btn-block-sm"
                      >
                        <Leaf size={11} />
                        Offset this product
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Confidence */}
              <section>
                <SectionHeader icon={<CheckCircle2 size={11} />}>
                  Confidence
                </SectionHeader>
                <div className="tile p-4 corner-mark">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`display text-[22px] capitalize ${
                          CONFIDENCE_COLOR[trace.confidence.level] ?? 'text-zinc-300'
                        }`}
                      >
                        {trace.confidence.level}
                      </span>
                      {trace.confidence.level === 'low' && (
                        <AlertTriangle size={13} className="text-orange-400" />
                      )}
                    </div>
                    <span className="display-mono text-zinc-200 text-[18px]">
                      {(trace.confidence.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 bg-[#0d1612] overflow-hidden">
                    <div
                      className="h-full transition-all duration-700"
                      style={{
                        width: `${trace.confidence.score * 100}%`,
                        backgroundColor:
                          CONFIDENCE_FILL[trace.confidence.level] ?? '#71717a',
                        boxShadow: `0 0 12px ${
                          CONFIDENCE_FILL[trace.confidence.level] ?? '#71717a'
                        }`
                      }}
                    />
                  </div>
                </div>
              </section>

              {/* Inputs */}
              <section>
                <SectionHeader icon={<Hash size={11} />}>Inputs</SectionHeader>
                <div className="tile p-4 corner-mark font-mono text-xs space-y-1.5">
                  <KvRow k="category" v={trace.inputs.category} />
                  <KvRow
                    k="price"
                    v={`$${trace.inputs.price_usd.toFixed(2)} ${trace.inputs.currency}`}
                  />
                  {trace.inputs.region && (
                    <KvRow k="region" v={trace.inputs.region} />
                  )}
                  {trace.isic4_code && (
                    <KvRow k="isic4_code" v={trace.isic4_code} accent />
                  )}
                  {trace.climatiq_activity_id && (
                    <KvRow k="activity_id" v={trace.climatiq_activity_id} />
                  )}
                </div>
              </section>

              {/* Computation steps */}
              {trace.computation_steps.length > 0 && (
                <section>
                  <SectionHeader icon={<Activity size={11} />}>
                    Computation Steps
                  </SectionHeader>
                  <div className="tile p-4 corner-mark space-y-2.5">
                    {trace.computation_steps.map((step, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 text-[12px] font-mono text-zinc-300 leading-relaxed"
                      >
                        <span className="text-[#b6ff3c]/60 mt-0.5">
                          <ChevronRight size={11} />
                        </span>
                        <span className="flex-1">{step}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Assumptions */}
              {trace.assumptions.length > 0 && (
                <section>
                  <SectionHeader icon={<FileText size={11} />}>
                    Assumptions
                  </SectionHeader>
                  <div className="tile p-4 corner-mark">
                    <ul className="space-y-2">
                      {trace.assumptions.map((a, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-3 text-xs text-zinc-400"
                        >
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

              {/* Methodology */}
              <section>
                <SectionHeader icon={<Cpu size={11} />}>Methodology</SectionHeader>
                <div className="tile p-4 corner-mark space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="stencil text-[10px] text-zinc-500">
                      version
                    </span>
                    <span className="display-mono text-[#b6ff3c] text-[14px] border border-[var(--rule)] px-2 py-0.5 bg-[#0a110d]">
                      {trace.methodology_version}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="stencil text-[10px] text-zinc-500">
                      data source
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-widest border px-2 py-0.5 font-mono ${
                        SOURCE_BADGE[trace.data_source] ?? ''
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

function SectionHeader({
  icon,
  children
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-[#b6ff3c]/70">{icon}</span>
      <span className="stencil text-[10px] text-zinc-400">{children}</span>
      <div className="flex-1 ring-divider opacity-40" />
    </div>
  );
}

function KvRow({
  k,
  v,
  accent = false
}: {
  k: string;
  v: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500 uppercase tracking-widest text-[10px]">{k}</span>
      <span className={accent ? 'text-[#b6ff3c]' : 'text-zinc-200'}>{v}</span>
    </div>
  );
}
