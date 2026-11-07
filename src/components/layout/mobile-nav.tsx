'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { BrandMark } from './brand';
import { SidebarNav } from './sidebar-nav';

export function MobileNav({ userSlot }: { userSlot: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-neutral-800 bg-ink px-4 lg:hidden">
        <BrandMark />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-neutral-300 hover:bg-white/10"
          aria-label="Open navigation"
          aria-expanded={open}
        >
          <Menu className="size-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-ink">
            <div className="flex h-14 items-center justify-between px-4">
              <BrandMark />
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-neutral-300 hover:bg-white/10" aria-label="Close navigation">
                <X className="size-5" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
            <div className="border-t border-neutral-800 p-3">{userSlot}</div>
          </div>
        </div>
      )}
    </>
  );
}
