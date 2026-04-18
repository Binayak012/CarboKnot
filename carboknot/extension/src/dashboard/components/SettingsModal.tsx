import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/dashboard/components/ui/dialog';
import { Button } from '@/dashboard/components/ui/button';
import { Separator } from '@/dashboard/components/ui/separator';
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
      <DialogContent className="bg-[#04080a] text-zinc-100 max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <div className="sticky top-0 bg-[#04080a]/95 backdrop-blur-xl border-b border-emerald-900/30 px-6 py-4 z-10">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-400">
                Settings
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-emerald-900/40 to-transparent" />
            </div>
            <DialogTitle className="text-zinc-50 text-base">Network & Data</DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 py-6 space-y-6">

          <section>
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={13} className="text-emerald-400" />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                Network Allowlist
              </h3>
              <span className="chip chip-accent ml-auto">2 endpoints</span>
            </div>

            <div className="surface-accent rounded-xl p-4 mb-3 relative overflow-hidden">
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

              <div className="relative space-y-3">
                <FlowRow
                  from="Browser"
                  to="Climatiq"
                  via="Render proxy"
                  payload="ISIC4 code + price"
                  trigger="First view of new (category, price) bucket"
                />
                <Separator className="bg-emerald-900/30" />
                <FlowRow
                  from="Browser"
                  to="Dedalus GPT-5"
                  via="Render proxy"
                  payload="2 titles + 2 kg values"
                  trigger="User clicks 'Why is this lower carbon?'"
                />
              </div>
            </div>

            <p className="text-xs text-zinc-500 leading-relaxed">
              That is everything.{' '}
              <span className="text-zinc-300">
                No identity, no browsing history, no titles for carbon lookups.
              </span>{' '}
              Cached lookups are reused forever and never re-sent. Open DevTools Network tab to verify.
            </p>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <Cpu size={13} className="text-zinc-500" />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                Methodology
              </h3>
            </div>
            <div className="surface rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-zinc-500 mb-1">Active version</div>
                <span className="font-mono text-sm text-zinc-100 bg-zinc-900 border border-zinc-800 rounded px-3 py-1">
                  {methodologyVersion}
                </span>
              </div>
              <div className="text-right">
                <div className="text-xs text-zinc-500 mb-1">Source</div>
                <span className="text-xs text-zinc-200">Climatiq · EXIOBASE spend-based LCA</span>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <HardDrive size={13} className="text-zinc-500" />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                Local Data
              </h3>
            </div>
            <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={16} className="text-rose-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm text-zinc-100 font-medium mb-1">Reset all data</div>
                  <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
                    Permanently clears all cached carbon estimates and view history from local storage.
                    This cannot be undone.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="bg-rose-900/60 hover:bg-rose-800/70 text-rose-200 border border-rose-800/50 gap-2"
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
                  </Button>
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
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-200">
          {from}
        </span>
        <ArrowRight size={12} className="text-zinc-600" />
        <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 flex items-center gap-1.5">
          <Globe size={10} className="text-emerald-400" />
          {via}
        </span>
        <ArrowRight size={12} className="text-zinc-600" />
        <span className="px-2 py-1 rounded bg-emerald-950/40 border border-emerald-800/40 text-emerald-300">
          {to}
        </span>
      </div>
      <div className="text-[11px] text-zinc-500 pl-1 flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <span className="text-zinc-600">payload:</span>{' '}
          <span className="text-zinc-300 font-mono">{payload}</span>
        </span>
        <span>
          <span className="text-zinc-600">when:</span>{' '}
          <span className="text-zinc-300">{trigger}</span>
        </span>
      </div>
    </div>
  );
}
