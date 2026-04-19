import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/dashboard/components/ui/dialog';
import {
  ShieldCheck,
  ArrowRight,
  Globe,
  HardDrive,
  Cpu,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { resetAll } from '@/storage/db.js';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  methodologyVersion: string;
}

export function SettingsModal({
  open,
  onClose,
  methodologyVersion
}: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#04080a] text-zinc-100 max-w-2xl max-h-[90vh] overflow-y-auto p-0 border border-[rgba(182,255,60,0.32)]">
        {/* Header — stencil + ledger style */}
        <div className="sticky top-0 bg-[#04080a]/95 backdrop-blur-xl border-b border-[var(--rule)] px-6 py-5 z-10">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-3">
              <span className="stencil text-[10px] text-[#b6ff3c]">SETTINGS</span>
              <div className="flex-1 ring-divider" />
              <span className="chip chip-acid">SYSTEM</span>
            </div>
            <DialogTitle className="display text-zinc-50 text-[24px]">
              Network &amp; Data
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* Network allowlist */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={13} className="text-[#b6ff3c]" />
              <h3 className="stencil text-[10px] text-zinc-300">
                Network Allowlist
              </h3>
              <span className="chip chip-acid ml-auto">2 endpoints</span>
            </div>

            <div className="tile-acid p-5 mb-3 corner-mark relative overflow-hidden">
              <div className="absolute inset-0 hatch opacity-30 pointer-events-none" />
              <div className="relative space-y-4">
                <FlowRow
                  from="Browser"
                  to="Climatiq"
                  via="Render proxy"
                  payload="ISIC4 code + price"
                  trigger="First view of new (category, price) bucket"
                />
                <div className="border-t border-[rgba(182,255,60,0.22)]" />
                <FlowRow
                  from="Browser"
                  to="Dedalus GPT-5"
                  via="Render proxy"
                  payload="2 titles + 2 kg values"
                  trigger="User clicks 'Why is this lower carbon?'"
                />
              </div>
            </div>

            <p className="text-xs text-zinc-500 leading-relaxed font-mono">
              That is everything.{' '}
              <span className="text-zinc-200">
                No identity, no browsing history, no titles for carbon lookups.
              </span>{' '}
              Cached lookups are reused forever and never re-sent. Open DevTools
              Network tab to verify.
            </p>
          </section>

          {/* Methodology */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Cpu size={13} className="text-zinc-500" />
              <h3 className="stencil text-[10px] text-zinc-300">Methodology</h3>
            </div>
            <div className="tile p-5 corner-mark flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="stencil text-[10px] text-zinc-500 mb-2">
                  Active version
                </div>
                <span className="display-mono text-[#b6ff3c] text-[24px] acid-glow">
                  {methodologyVersion}
                </span>
              </div>
              <div className="text-right">
                <div className="stencil text-[10px] text-zinc-500 mb-2">
                  Source
                </div>
                <span className="text-xs text-zinc-200 font-mono uppercase tracking-widest">
                  Climatiq · EXIOBASE LCA
                </span>
              </div>
            </div>
          </section>

          {/* Local data — danger zone */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <HardDrive size={13} className="text-zinc-500" />
              <h3 className="stencil text-[10px] text-zinc-300">Local Data</h3>
            </div>
            <div className="border border-rose-900/50 bg-rose-950/20 p-5 corner-mark relative">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  size={16}
                  className="text-rose-400 mt-0.5 shrink-0"
                />
                <div className="flex-1">
                  <div className="display text-zinc-100 text-[18px] mb-1">
                    Reset all data
                  </div>
                  <p className="text-xs text-zinc-400 mb-4 leading-relaxed font-mono">
                    Permanently clears all cached carbon estimates and view
                    history from local storage. This cannot be undone.
                  </p>
                  <button
                    className="btn-block"
                    style={{
                      borderColor: 'rgba(244, 63, 94, 0.5)',
                      background: 'rgba(244, 63, 94, 0.08)',
                      color: '#fda4af'
                    }}
                    onClick={async () => {
                      try {
                        await resetAll();
                      } catch (err) {
                        console.warn('[carboknot] reset failed', err);
                      }
                      onClose();
                      window.location.reload();
                    }}
                  >
                    <Trash2 size={12} />
                    Reset All Data
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FlowRow({
  from,
  to,
  via,
  payload,
  trigger
}: {
  from: string;
  to: string;
  via: string;
  payload: string;
  trigger: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
        <span className="px-2 py-1 border border-[var(--rule)] bg-[#0a110d] text-zinc-200 uppercase tracking-widest text-[10px]">
          {from}
        </span>
        <ArrowRight size={12} className="text-zinc-600" />
        <span className="px-2 py-1 border border-[var(--rule)] bg-[#0a110d] text-zinc-400 flex items-center gap-1.5 uppercase tracking-widest text-[10px]">
          <Globe size={10} className="text-[#b6ff3c]" />
          {via}
        </span>
        <ArrowRight size={12} className="text-zinc-600" />
        <span className="px-2 py-1 border border-[rgba(182,255,60,0.45)] bg-[rgba(182,255,60,0.06)] text-[#d8ffb0] uppercase tracking-widest text-[10px]">
          {to}
        </span>
      </div>
      <div className="text-[10px] text-zinc-500 pl-1 flex flex-wrap gap-x-4 gap-y-1 font-mono uppercase tracking-widest">
        <span>
          <span className="text-zinc-600">payload:</span>{' '}
          <span className="text-zinc-300 normal-case tracking-normal">
            {payload}
          </span>
        </span>
        <span>
          <span className="text-zinc-600">when:</span>{' '}
          <span className="text-zinc-300 normal-case tracking-normal">
            {trigger}
          </span>
        </span>
      </div>
    </div>
  );
}
