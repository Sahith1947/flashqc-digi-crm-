'use client';
import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { NavList } from './nav-list';

function ActiveNav({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList activePath={usePathname()} onNavigate={onNavigate} />;
}

/** The pathname is request data, so the highlighted nav streams in; the plain list is prerendered. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList activePath={null} onNavigate={onNavigate} />}>
      <ActiveNav onNavigate={onNavigate} />
    </Suspense>
  );
}
