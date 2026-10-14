'use client';

import { useEffect, useRef, useState } from 'react';

export interface MoreMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** A "⋯" button holding a card's or board's less common actions, such as Rename and Delete. */
export default function MoreMenu({ label, items, disabled = false }: { label: string; items: MoreMenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center justify-center min-h-11 min-w-11 text-lg leading-none text-gray-700 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-40 py-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className="w-full min-h-11 px-3 text-left text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
