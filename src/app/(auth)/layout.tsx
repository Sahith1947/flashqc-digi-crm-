import { BrandMark } from '@/components/layout/brand';

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-10 lg:flex">
        <BrandMark />
        <div className="max-w-md">
          <p className="text-3xl leading-tight font-semibold text-white">
            Every call, campaign and conversation, <span className="text-brand-400">in one place.</span>
          </p>
          <p className="mt-4 text-sm text-neutral-400">
            Inbound and outbound calling, bulk campaigns, recordings, transcripts and analytics for the FlashQC Digi team.
          </p>
        </div>
        <p className="text-xs text-neutral-500">© FlashQC Digi. Internal use only.</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandMark dark={false} />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
