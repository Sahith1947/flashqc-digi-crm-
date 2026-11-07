import { LinkButton } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-ink-2">The page or record you are looking for does not exist or was removed.</p>
      <LinkButton href="/" variant="dark" className="mt-2">
        Back to overview
      </LinkButton>
    </div>
  );
}
