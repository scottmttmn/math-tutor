'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SessionType } from '@/types';
import SettingsModal from './SettingsModal';

export type AppPlace = 'home' | 'shelf' | 'board';

interface Props {
  /** Where the page sits; its tab is shown as current. */
  place: AppPlace;
  /** Starts a new board in place (the board page); elsewhere New goes to /board. */
  onNew?: (type: SessionType) => void;
  /** Blocks leaving the page, e.g. while a tutor reply streams in. */
  locked?: boolean;
  /** Page-specific controls, shown before New. */
  children?: ReactNode;
}

const PLACES: { place: AppPlace; href: string; label: string; icon: ReactNode }[] = [
  { place: 'home', href: '/', label: 'Home', icon: <HomeIcon /> },
  { place: 'shelf', href: '/shelf', label: 'Shelf', icon: <ShelfIcon /> },
];

/** The bar on every page: Home and Shelf, New, and Settings. Full screen hides it. */
export default function AppBar({ place, onNew, locked = false, children }: Props) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const newRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!newOpen) return;
    const close = (event: MouseEvent) => {
      if (newRef.current && !newRef.current.contains(event.target as Node)) setNewOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [newOpen]);

  const startNew = (type: SessionType) => {
    setNewOpen(false);
    if (onNew) onNew(type);
    else router.push(`/board?new=${type}`);
  };

  return (
    <nav aria-label="Main" className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 border-b border-gray-200 bg-white">
      <span className="hidden sm:inline px-1 mr-1 text-base font-bold text-gray-900">Math Tutor</span>
      {PLACES.map((item) => (
        <Link
          key={item.place}
          href={item.href}
          aria-label={item.label}
          aria-current={place === item.place ? 'page' : undefined}
          aria-disabled={locked}
          onClick={(event) => { if (locked) event.preventDefault(); }}
          className={`flex items-center gap-1.5 min-h-10 px-3 text-sm rounded-lg ${
            place === item.place ? 'font-semibold text-gray-900 bg-gray-100' : 'text-gray-600 hover:bg-gray-50'
          } ${locked ? 'opacity-50' : ''}`}
        >
          {item.icon}
          <span className="hidden sm:inline">{item.label}</span>
        </Link>
      ))}

      <div className="flex-1" />
      {children}

      <div ref={newRef} className="relative">
        <button
          onClick={() => setNewOpen((open) => !open)}
          disabled={locked}
          aria-expanded={newOpen}
          className="flex items-center gap-1 min-h-10 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-50"
        >
          <span aria-hidden="true">+</span> New
        </button>
        {newOpen && (
          <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
            <button onClick={() => startNew('problem')} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
              New Problem
            </button>
            <button onClick={() => startNew('note')} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
              New Notes
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="Settings"
        title="Tutor model and settings"
        className="flex items-center justify-center min-h-10 min-w-10 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
      >
        <GearIcon />
      </button>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </nav>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 7.5L8 2.5l6 5M3.5 6.5v7h9v-7" />
    </svg>
  );
}

function ShelfIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}
