import { Zap } from 'lucide-react';

export function BrandMark({ dark = true }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-ink">
        <Zap className="size-4.5" fill="currentColor" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className={`block text-sm font-bold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>FlashQC Digi</span>
        <span className={`block text-[11px] font-medium ${dark ? 'text-neutral-400' : 'text-ink-3'}`}>Call Operations</span>
      </span>
    </span>
  );
}
