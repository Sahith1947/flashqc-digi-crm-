import { Suspense } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/layout/brand';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import { MobileNav } from '@/components/layout/mobile-nav';
import { UserMenu, UserMenuFallback } from '@/components/layout/user-menu';

// The shell (sidebar) is static and prerendered; user-specific parts stream in
// behind Suspense. Each page authorises itself via requireMember().
export default function AppLayout({ children }: LayoutProps<'/'>) {
  const user = (
    <Suspense fallback={<UserMenuFallback />}>
      <UserMenu />
    </Suspense>
  );
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-ink lg:flex">
        <Link href="/" className="flex h-16 items-center px-5">
          <BrandMark />
        </Link>
        <SidebarNav />
        <div className="border-t border-neutral-800 p-3">{user}</div>
      </aside>
      <MobileNav userSlot={user} />
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
